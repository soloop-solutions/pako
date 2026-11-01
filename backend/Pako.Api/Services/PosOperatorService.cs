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

    private record Claim(Guid CompanyId, Guid UserId);

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

    // The member whose PIN this is (an active member of the company), with a token for the till.
    public async Task<(Guid UserId, string Token, DateTime ExpiresAt)?> SignInAsync(Guid companyId, string pin)
    {
        var pins = await _db.PosPins.AsNoTracking().Where(p => p.CompanyId == companyId).ToListAsync();
        var match = pins.FirstOrDefault(p => _hasher.VerifyHashedPassword(p, p.PinHash, pin ?? "") != PasswordVerificationResult.Failed);
        if (match is null || !await IsMemberAsync(companyId, match.UserId)) return null;
        var expires = DateTimeOffset.UtcNow.Add(Lifetime);
        var token = _protector.Protect(JsonSerializer.Serialize(new Claim(companyId, match.UserId)), expires);
        return (match.UserId, token, expires.UtcDateTime);
    }

    // The operator a request names, or null when there is no (valid) token for this company.
    public async Task<Guid?> OperatorAsync(HttpRequest request, Guid companyId)
    {
        var token = request.Headers[Header].ToString();
        if (string.IsNullOrEmpty(token)) return null;
        try
        {
            var claim = JsonSerializer.Deserialize<Claim>(_protector.Unprotect(token));
            if (claim is null || claim.CompanyId != companyId || !await IsMemberAsync(companyId, claim.UserId)) return null;
            return claim.UserId;
        }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or JsonException)
        {
            return null;
        }
    }

    private async Task<bool> IsMemberAsync(Guid companyId, Guid userId)
    {
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        return company is not null && await _db.Memberships.AsNoTracking().AnyAsync(m => m.UserId == userId && m.IsActive
            && (m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId)));
    }

    // How the operator appears on orders, tabs and coupons: their employee name, else their email's local part.
    public async Task<string> NameAsync(Guid companyId, Guid userId, string? fallbackEmail = null)
    {
        var name = await _db.Employees.AsNoTracking().Where(e => e.CompanyId == companyId && e.UserId == userId).Select(e => e.Name).FirstOrDefaultAsync();
        if (!string.IsNullOrWhiteSpace(name)) return name;
        var email = fallbackEmail ?? await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Email).FirstOrDefaultAsync();
        return string.IsNullOrWhiteSpace(email) ? userId.ToString()[..8] : email.Split('@')[0];
    }
}
