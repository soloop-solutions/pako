using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

// EnabledProfiles omitted/null seeds CORE only (Company.EnabledProfiles' own default) — CORE is
// always included regardless of what's passed, per 50_Profiles. IsVatRegistered omitted/null
// defaults to true (Company.IsVatRegistered's own default) — see C2 (tax-enums.ts / CLAUDE.md)
// for why a genuinely-empty "no tax" choice is only ever valid once this is false.
public record CreateCompanyRequest(string Name, Guid? FirmId = null, CompanyProfile? EnabledProfiles = null, bool? IsVatRegistered = null);

// B4: SaleLockDate/PurchaseLockDate/HardLockDate alongside the existing two.
// Company profile fields added in AddCompanyProfile migration; archive in AddCompanyArchive.
public record CompanyResponse(
    Guid Id, string Name, Guid? FirmId, DateOnly? AccountingLockDate, DateOnly? TaxLockDate,
    CompanyProfile EnabledProfiles, bool IsVatRegistered, bool AllowNumberOverride,
    DateOnly? SaleLockDate, DateOnly? PurchaseLockDate, DateOnly? HardLockDate,
    string FunctionalCurrency,
    string? TradingName, int? LegalForm, string? BusinessActivity, string? Description,
    string? BusinessNumber, string? FiscalNumber, string? VatNumber, DateOnly? VatRegistrationDate,
    string? Country, string? Municipality, string? StreetAddress, string? PostalCode, string? AddressLine2,
    string? Email, string? Phone, string? Website,
    string? BankName, string? BankAccountHolder, string? Iban, string? SwiftBic,
    string? DocumentFooter, string? PaymentInstructions,
    bool IsArchived);

public record UpdateCompanyProfileRequest(
    string Name,
    string? TradingName = null, int? LegalForm = null, string? BusinessActivity = null,
    string? Description = null, string? BusinessNumber = null, string? FiscalNumber = null,
    string? VatNumber = null, string? VatRegistrationDate = null,
    string? Country = null, string? Municipality = null, string? StreetAddress = null,
    string? PostalCode = null, string? AddressLine2 = null,
    string? Email = null, string? Phone = null, string? Website = null,
    string? BankName = null, string? BankAccountHolder = null, string? Iban = null,
    string? SwiftBic = null, string? DocumentFooter = null, string? PaymentInstructions = null);

// B4: LockDateField excludes HardLockDate by construction — the same enum backs both "which soft
// lock to set" and "which soft lock this exception is for", so a hard-lock exception is
// structurally impossible to request, not just refused after the fact.
public record SetSoftLockRequest(LockDateField LockDateField, DateOnly? LockDate);

public record SetHardLockRequest(DateOnly LockDate);

public record GrantLockExceptionRequest(Guid UserId, LockDateField LockDateField, DateOnly LockDate, string Reason, DateTime EndsAt);

public record AccountLockExceptionResponse(
    Guid Id, Guid UserId, LockDateField LockDateField, DateOnly LockDate, string Reason,
    DateTime EndsAt, DateTime CreatedAt, Guid GrantedByUserId, DateTime? RevokedAt, Guid? RevokedByUserId, bool IsLive);
