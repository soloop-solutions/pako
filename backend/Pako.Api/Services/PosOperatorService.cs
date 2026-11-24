using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/POS_PLAN.md §8.10 / P3: PIN sign-in on a shared till. The till's own account stays signed
// in; a waiter's PIN gets a short-lived operator token the till sends with each order and tab
// (X-Pos-Operator), so they carry the waiter, not the terminal.
public class PosOperatorService
{
    public const string Header = "X-Pos-Operator";
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);

    private readonly PakoDbContext _db;
    private readonly ITimeLimitedDataProtector _protector;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly PasswordHasher<PosPin> _hasher = new();

    public PosOperatorService(PakoDbContext db, IDataProtectionProvider protection, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _protector = protection.CreateProtector("Pako.Pos.Operator").ToTimeLimitedDataProtector();
        _localizer = localizer;
    }

    // Stamp: a fingerprint of the PIN the token was issued for, so a PIN the administrator changes
    // or a waiter resets ends every sign-in made with the old one (docs/POS_TILL_ACCESS.md).
    private record Claim(Guid CompanyId, Guid UserId, string? Stamp = null);

    private static string StampOf(string pinHash) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(pinHash)))[..16];

    // Wrong PINs in a row from one device, per company: after MaxFailures the device must wait
    // LockFor before trying again, so the 10,000 four-digit PINs can't simply be tried in turn.
    public const int MaxFailures = 5;
    public static readonly TimeSpan LockFor = TimeSpan.FromMinutes(5);
    private static readonly ConcurrentDictionary<(Guid CompanyId, string Client), (int Failures, DateTime LockedUntil)> Attempts = new();

    public async Task SetPinAsync(Guid companyId, Guid userId, string pin)
    {
        if (pin is null || pin.Length is < 4 or > 8 || !pin.All(char.IsAsciiDigit)) throw new PosException(_localizer["PosPinInvalid"].Value);
        var pins = await _db.PosPins.Where(p => p.CompanyId == companyId).ToListAsync();
        // A PIN alone identifies the waiter, so no two people may share one.
        if (pins.Any(p => p.UserId != userId && _hasher.VerifyHashedPassword(p, p.PinHash, pin) != PasswordVerificationResult.Failed))
        {
            throw new PosException(_localizer["PosPinTaken"].Value);
        }
        var own = pins.FirstOrDefault(p => p.UserId == userId);
        if (own is null)
        {
            own = new PosPin { Id = Guid.NewGuid(), CompanyId = companyId, UserId = userId };
            _db.PosPins.Add(own);
        }
        own.PinHash = _hasher.HashPassword(own, pin);
    }

    // An administrator gives a member a PIN: the one typed, or a random one no one else in the
    // company has. Returns the PIN so it can be shown once (it is stored hashed).
    public async Task<string> IssuePinAsync(Guid companyId, Guid userId, string? pin)
    {
        if (!await IsMemberAsync(companyId, userId)) throw new PosException(_localizer["PosStaffNotFound"].Value);
        if (string.IsNullOrWhiteSpace(pin)) pin = await GeneratePinAsync(companyId, userId);
        await SetPinAsync(companyId, userId, pin.Trim());
        return pin.Trim();
    }

    // Four digits while the space is roomy, six after repeated clashes; never an easy-to-guess run.
    private async Task<string> GeneratePinAsync(Guid companyId, Guid userId)
    {
        var others = await _db.PosPins.AsNoTracking().Where(p => p.CompanyId == companyId && p.UserId != userId).ToListAsync();
        for (var attempt = 0; attempt < 60; attempt++)
        {
            var digits = attempt < 40 ? 4 : 6;
            var candidate = RandomNumberGenerator.GetInt32(0, (int)Math.Pow(10, digits)).ToString($"D{digits}");
            if (IsWeakPin(candidate)) continue;
            if (others.All(p => _hasher.VerifyHashedPassword(p, p.PinHash, candidate) == PasswordVerificationResult.Failed)) return candidate;
        }
        throw new PosException(_localizer["PosPinTaken"].Value);
    }

    // All one digit (1111) or a straight run up or down (1234, 9876).
    public static bool IsWeakPin(string pin)
    {
        if (pin.Distinct().Count() == 1) return true;
        var steps = pin.Zip(pin.Skip(1), (a, b) => b - a).Distinct().ToList();
        return steps.Count == 1 && steps[0] is (1 or -1);
    }

    // The member whose PIN this is (an active member of the company), with a token for the till.
    // `client` identifies the device (its address) for the wrong-PIN lock; PosException when locked.
    public async Task<(Guid UserId, string Token, DateTime ExpiresAt)?> SignInAsync(Guid companyId, string pin, string client = "")
    {
        var key = (companyId, client);
        if (Attempts.TryGetValue(key, out var state) && state.LockedUntil > DateTime.UtcNow)
        {
            throw new PosException(_localizer["PosPinLocked"].Value);
        }
        var pins = await _db.PosPins.AsNoTracking().Where(p => p.CompanyId == companyId).ToListAsync();
        var match = pins.FirstOrDefault(p => _hasher.VerifyHashedPassword(p, p.PinHash, pin ?? "") != PasswordVerificationResult.Failed);
        if (match is null || !await IsMemberAsync(companyId, match.UserId))
        {
            Attempts.AddOrUpdate(key, (1, DateTime.MinValue), (_, s) =>
            {
                var failures = s.LockedUntil != DateTime.MinValue && s.LockedUntil <= DateTime.UtcNow ? 1 : s.Failures + 1;
                return failures >= MaxFailures ? (failures, DateTime.UtcNow.Add(LockFor)) : (failures, DateTime.MinValue);
            });
            return null;
        }
        Attempts.TryRemove(key, out _);
        var expires = DateTimeOffset.UtcNow.Add(Lifetime);
        var token = _protector.Protect(JsonSerializer.Serialize(new Claim(companyId, match.UserId, StampOf(match.PinHash))), expires);
        return (match.UserId, token, expires.UtcDateTime);
    }

    // The operator a request names, or null when there is no (valid) token for this company.
    // `fallbackToken`: a token carried in the body instead (an order rung up offline, sent later).
    public async Task<Guid?> OperatorAsync(HttpRequest request, Guid companyId, string? fallbackToken = null)
    {
        var token = request.Headers[Header].ToString();
        if (string.IsNullOrEmpty(token)) token = fallbackToken ?? "";
        if (string.IsNullOrEmpty(token)) return null;
        try
        {
            var claim = JsonSerializer.Deserialize<Claim>(_protector.Unprotect(token));
            if (claim is null || claim.CompanyId != companyId || !await IsMemberAsync(companyId, claim.UserId)) return null;
            // The PIN must still be the one signed in with (not changed or removed since).
            var hash = await _db.PosPins.AsNoTracking().Where(p => p.CompanyId == companyId && p.UserId == claim.UserId)
                .Select(p => p.PinHash).FirstOrDefaultAsync();
            if (hash is null || claim.Stamp != StampOf(hash)) return null;
            return claim.UserId;
        }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or JsonException)
        {
            return null;
        }
    }

    // The id a till operator goes by: their login when they have one, else their employee record
    // (user request 2026-11-24: waiters who only use the shared till need no account).
    public static Guid OperatorIdOf(Pako.Domain.Payroll.Employee employee) => employee.UserId ?? employee.Id;

    // An active member of the company, or an employee without a login who hasn't left.
    private async Task<bool> IsMemberAsync(Guid companyId, Guid operatorId)
    {
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return false;
        if (await _db.Memberships.AsNoTracking().AnyAsync(m => m.UserId == operatorId && m.IsActive
            && m.Role != Pako.Domain.Companies.MembershipRole.ClientCustomer
            // A till device is not a person: it never gets a PIN (docs/POS_TILL_ACCESS.md §7).
            && !_db.CompanyRoles.Any(r => r.Id == m.CompanyRoleId && r.BuiltInKey == PosDeviceService.RoleKey)
            && (m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId))))
        {
            return true;
        }
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        return await _db.Employees.AsNoTracking().AnyAsync(e => e.CompanyId == companyId && e.Id == operatorId && e.UserId == null
            && (e.TerminationDate == null || e.TerminationDate >= today));
    }

    // How the operator appears on orders, tabs and coupons: their employee name, else their email's local part.
    public async Task<string> NameAsync(Guid companyId, Guid userId, string? fallbackEmail = null)
    {
        var name = await _db.Employees.AsNoTracking().Where(e => e.CompanyId == companyId && (e.UserId == userId || e.Id == userId)).Select(e => e.Name).FirstOrDefaultAsync();
        if (!string.IsNullOrWhiteSpace(name)) return name;
        var email = fallbackEmail ?? await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Email).FirstOrDefaultAsync();
        return string.IsNullOrWhiteSpace(email) ? userId.ToString()[..8] : email.Split('@')[0];
    }

    // ---- Till access rules (docs/POS_TILL_ACCESS.md) ----

    // Once a company has issued any staff PIN, the till's work (sessions, orders, tabs, cash) needs
    // a PIN-signed-in operator: the device's own login alone is refused.
    public async Task<bool> PinRequiredAsync(HttpRequest request, Guid companyId, string? fallbackToken = null) =>
        await _db.PosPins.AsNoTracking().AnyAsync(p => p.CompanyId == companyId)
        && await OperatorAsync(request, companyId, fallbackToken) is null;

    // Manager actions (returns, voiding what the kitchen has, closing setup) on a till go by the
    // signed-in operator's own rights, not the device's login: a waiter on a till logged in as the
    // owner is still a waiter. With no operator signed in, the device's login decides.
    public async Task<bool> MayApproveAsync(HttpRequest request, Guid companyId, Pako.Api.Authorization.CompanyAccessContext access,
        string? fallbackToken = null) =>
        await OperatorAsync(request, companyId, fallbackToken) is { } op
            ? await CanApproveAsync(companyId, op)
            : access.LevelFor(Pako.Domain.Hr.AccessModule.Pos) >= Pako.Domain.Hr.AccessLevel.Approve;

    // An operator with a login who is an administrator or accountant of the company, or staff whose
    // role grants POS: Approve. An employee who only has a PIN never can.
    public async Task<bool> CanApproveAsync(Guid companyId, Guid operatorId)
    {
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return false;
        var memberships = await _db.Memberships.AsNoTracking().Where(m => m.UserId == operatorId && m.IsActive
            && (m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId)))
            .Select(m => new { m.Role, m.CompanyRoleId }).ToListAsync();
        if (memberships.Any(m => m.Role is Pako.Domain.Companies.MembershipRole.FirmAdmin or Pako.Domain.Companies.MembershipRole.FirmAccountant
            or Pako.Domain.Companies.MembershipRole.ClientAdmin)) return true;
        var roleIds = memberships.Where(m => m.Role == Pako.Domain.Companies.MembershipRole.ClientStaff && m.CompanyRoleId != null)
            .Select(m => m.CompanyRoleId!.Value).ToList();
        var roles = await _db.CompanyRoles.AsNoTracking().Where(r => roleIds.Contains(r.Id) && r.CompanyId == companyId).ToListAsync();
        return roles.Any(r => r.LevelFor(Pako.Domain.Hr.AccessModule.Pos) >= Pako.Domain.Hr.AccessLevel.Approve);
    }
}
