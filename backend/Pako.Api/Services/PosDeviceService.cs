using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Auth;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Services;

// docs/POS_TILL_ACCESS.md §7 (user request 2026-11-24): a till or kitchen screen signs in as a
// *device*, not as a person. A device is a login with no password, one membership in one company
// and the built-in "Till device" role (POS: Write, Items: Read — nothing else), so leaving the
// till leads nowhere. An administrator adds it in POS setup and connects it with a one-use link
// (or its QR code); disconnecting it ends its sessions at once.
public class PosDeviceService
{
    public const string RoleKey = "pos-device";
    public const string EmailDomain = "devices.pako.invalid";
    public static readonly TimeSpan LinkLifetime = TimeSpan.FromHours(24);

    // A short code beside each link, for a till PC where nobody can scan a QR code or paste a
    // link: 8 characters with no 0/O or 1/I to misread (40 bits; device-connect is rate-limited).
    // It stands for the link, in the identity tokens table (no migration), and dies with it.
    private const string PairAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private const string PairProvider = "PakoDevice";
    private const string PairName = "PairCode";

    private readonly PakoDbContext _db;
    private readonly UserManager<AppUser> _users;
    private readonly RefreshTokenService _refreshTokens;
    private readonly ITimeLimitedDataProtector _protector;

    public PosDeviceService(PakoDbContext db, UserManager<AppUser> users, RefreshTokenService refreshTokens, IDataProtectionProvider protection)
    {
        _db = db;
        _users = users;
        _refreshTokens = refreshTokens;
        _protector = protection.CreateProtector("Pako.Pos.DeviceLink").ToTimeLimitedDataProtector();
    }

    // Stamp = the device user's security stamp when the link was made: pairing changes it, so a
    // link works once, and making a new link ends the old one.
    private record LinkClaim(Guid CompanyId, Guid UserId, string Stamp);

    public record Device(Guid Id, string Name, bool Active, DateTime CreatedAt, DateTime? LastSeenAt, bool Connected);

    public static bool IsDeviceEmail(string? email) => email?.EndsWith("@" + EmailDomain, StringComparison.OrdinalIgnoreCase) == true;

    // The company's device role, created the first time a device is added. It is never listed
    // with the roles an administrator edits or assigns (UserAdminService).
    public async Task<CompanyRole> RoleAsync(Guid companyId)
    {
        var role = await _db.CompanyRoles.FirstOrDefaultAsync(r => r.CompanyId == companyId && r.BuiltInKey == RoleKey);
        if (role is not null) return role;
        role = new CompanyRole
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Name = "Till device", BuiltInKey = RoleKey,
            Description = "A till or kitchen screen: POS only.", PosAccess = AccessLevel.Write, ItemsAccess = AccessLevel.Read,
        };
        _db.CompanyRoles.Add(role);
        await _db.SaveChangesAsync();
        return role;
    }

    public async Task<Guid?> RoleIdAsync(Guid companyId) =>
        await _db.CompanyRoles.AsNoTracking().Where(r => r.CompanyId == companyId && r.BuiltInKey == RoleKey).Select(r => (Guid?)r.Id).FirstOrDefaultAsync();

    public async Task<List<Device>> ListAsync(Guid companyId)
    {
        if (await RoleIdAsync(companyId) is not { } roleId) return new();
        var memberships = await _db.Memberships.AsNoTracking().Where(m => m.CompanyId == companyId && m.CompanyRoleId == roleId).ToListAsync();
        var ids = memberships.Select(m => m.UserId).ToList();
        var users = await _db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        // Last seen: the device's latest token renewal (it renews every 15 minutes while in use).
        var seen = await _db.RefreshTokens.AsNoTracking().Where(t => ids.Contains(t.UserId))
            .GroupBy(t => t.UserId).Select(g => new { g.Key, Last = g.Max(t => t.CreatedAt), Live = g.Any(t => t.RevokedAt == null && t.ExpiresAt > DateTime.UtcNow) })
            .ToDictionaryAsync(x => x.Key);
        return memberships.Where(m => users.ContainsKey(m.UserId)).Select(m =>
        {
            var user = users[m.UserId];
            var s = seen.GetValueOrDefault(m.UserId);
            var active = m.IsActive && !user.IsDisabled;
            return new Device(user.Id, user.FullName ?? "", active, user.CreatedAt, s?.Last, active && s?.Live == true);
        }).OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    public async Task<Device> CreateAsync(Guid companyId, string name)
    {
        var role = await RoleAsync(companyId);
        var id = Guid.NewGuid();
        var email = $"till-{id:N}@{EmailDomain}";
        var user = new AppUser { Id = id, UserName = email, Email = email, EmailConfirmed = true, FullName = name, CompanyLimit = 0 };
        // A password no one knows: a device only ever signs in through its link.
        var created = await _users.CreateAsync(user, RandomPassword());
        if (!created.Succeeded) throw new InvalidOperationException(string.Join(" ", created.Errors.Select(e => e.Description)));
        _db.Memberships.Add(new Membership { Id = Guid.NewGuid(), UserId = id, CompanyId = companyId, Role = MembershipRole.ClientStaff, CompanyRoleId = role.Id, IsActive = true });
        await _db.SaveChangesAsync();
        return new Device(id, name, true, user.CreatedAt, null, false);
    }

    // The device's membership in this company, or null when the id isn't one of its devices.
    private async Task<(AppUser User, Membership Membership)?> FindAsync(Guid companyId, Guid deviceId)
    {
        if (await RoleIdAsync(companyId) is not { } roleId) return null;
        var membership = await _db.Memberships.FirstOrDefaultAsync(m => m.CompanyId == companyId && m.UserId == deviceId && m.CompanyRoleId == roleId);
        var user = membership is null ? null : await _users.FindByIdAsync(deviceId.ToString());
        return user is null ? null : (user, membership!);
    }

    public async Task<bool> RenameAsync(Guid companyId, Guid deviceId, string name)
    {
        if (await FindAsync(companyId, deviceId) is not { } found) return false;
        found.User.FullName = name;
        await _users.UpdateAsync(found.User);
        return true;
    }

    // A new connect link (and switches a disconnected device back on): valid for LinkLifetime,
    // once. Connecting with it signs out wherever the device was connected before.
    public async Task<(string Code, string PairCode, DateTime ExpiresAt)?> LinkAsync(Guid companyId, Guid deviceId)
    {
        if (await FindAsync(companyId, deviceId) is not { } found) return null;
        found.Membership.IsActive = true;
        found.User.IsDisabled = false;
        await _users.UpdateSecurityStampAsync(found.User);
        await _db.SaveChangesAsync();
        var expires = DateTimeOffset.UtcNow.Add(LinkLifetime);
        var code = _protector.Protect(JsonSerializer.Serialize(new LinkClaim(companyId, deviceId, found.User.SecurityStamp!)), expires);
        var pair = new string(RandomNumberGenerator.GetItems<char>(PairAlphabet, 8));
        await ForgetPairCodeAsync(deviceId);
        var token = new IdentityUserToken<Guid> { UserId = deviceId, LoginProvider = PairProvider, Name = PairName, Value = $"{HashPairCode(pair)}|{code}" };
        _db.UserTokens.Add(token);
        await _db.SaveChangesAsync();
        // Removed later with ExecuteDelete, which the change tracker doesn't see: don't keep it tracked.
        _db.Entry(token).State = EntityState.Detached;
        return (code, $"{pair[..4]}-{pair[4..]}", expires.UtcDateTime);
    }

    // "k7m4 qp2x" → "K7M4QP2X"; null when it isn't a pair code (a link's long code).
    public static string? NormalizePairCode(string? input)
    {
        var cleaned = new string((input ?? "").Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());
        return cleaned.Length == 8 && cleaned.All(PairAlphabet.Contains) ? cleaned : null;
    }

    private static string HashPairCode(string normalized) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(normalized)));

    private Task ForgetPairCodeAsync(Guid deviceId) =>
        _db.UserTokens.Where(t => t.UserId == deviceId && t.LoginProvider == PairProvider && t.Name == PairName).ExecuteDeleteAsync();

    // The device a link connects, or null for a wrong, used or expired link or a disconnected device.
    public async Task<(AppUser User, Guid CompanyId)?> PairAsync(string code)
    {
        if (NormalizePairCode(code) is { } pair)
        {
            var prefix = HashPairCode(pair) + "|";
            var stored = await _db.UserTokens.AsNoTracking()
                .Where(t => t.LoginProvider == PairProvider && t.Name == PairName && t.Value!.StartsWith(prefix))
                .Select(t => t.Value).FirstOrDefaultAsync();
            if (stored is null) return null;
            code = stored[prefix.Length..];
        }
        LinkClaim? claim;
        try
        {
            claim = JsonSerializer.Deserialize<LinkClaim>(_protector.Unprotect(code ?? ""));
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or FormatException)
        {
            return null;
        }
        if (claim is null || await FindAsync(claim.CompanyId, claim.UserId) is not { } found) return null;
        if (!found.Membership.IsActive || found.User.IsDisabled || found.User.SecurityStamp != claim.Stamp) return null;
        // One link, one device: the link (and its short code) is spent, and any earlier connection ends.
        await ForgetPairCodeAsync(found.User.Id);
        await _users.UpdateSecurityStampAsync(found.User);
        await _refreshTokens.RevokeAllForUserAsync(found.User.Id);
        found.User.LastLoginAt = DateTime.UtcNow;
        await _users.UpdateAsync(found.User);
        return (found.User, claim.CompanyId);
    }

    // Switches the device off: its membership is deactivated (the next request is refused) and
    // its sessions end. A new link switches it back on.
    public async Task<bool> DisconnectAsync(Guid companyId, Guid deviceId)
    {
        if (await FindAsync(companyId, deviceId) is not { } found) return false;
        found.Membership.IsActive = false;
        await _db.SaveChangesAsync();
        await ForgetPairCodeAsync(deviceId);
        await _users.UpdateSecurityStampAsync(found.User);
        await _refreshTokens.RevokeAllForUserAsync(deviceId);
        return true;
    }

    // The company a signed-in device belongs to, or null when the user isn't a device.
    public async Task<(Guid CompanyId, string Name)?> DeviceOfAsync(Guid userId)
    {
        var device = await (from m in _db.Memberships.AsNoTracking()
                            join r in _db.CompanyRoles.AsNoTracking() on m.CompanyRoleId equals r.Id
                            where m.UserId == userId && m.IsActive && r.BuiltInKey == RoleKey && m.CompanyId != null
                            select new { CompanyId = m.CompanyId!.Value }).FirstOrDefaultAsync();
        if (device is null) return null;
        var name = await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.FullName).FirstOrDefaultAsync();
        return (device.CompanyId, name ?? "");
    }

    private static string RandomPassword() =>
        "Dv1!" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(36)).Replace('+', 'x').Replace('/', 'y');
}
