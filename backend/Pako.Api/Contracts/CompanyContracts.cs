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
    // Profile
    string? TradingName, string? BusinessNumber, string? FiscalNumber, string? VatNumber,
    int? LegalForm, string? BusinessActivity, string? Description,
    // Address
    string? Country, string? Municipality, string? StreetAddress, string? PostalCode, string? AddressLine2,
    // Contact
    string? Email, string? Phone, string? Website,
    // Banking (legacy single-bank fields kept for backward compat)
    string? BankName, string? BankAccountHolder, string? Iban, string? SwiftBic,
    // Document
    string? DocumentFooter, string? PaymentInstructions,
    // Branding
    string? LogoUrl, string? StampUrl,
    // Tax
    DateOnly? VatRegistrationDate,
    string FunctionalCurrency,
    // Archive
    bool IsArchived,
    DateTime? ArchivedAt);

public record CompanyBankAccountResponse(
    Guid Id, string BankName, string? AccountHolder, string? Iban, string? SwiftBic,
    bool IsDefault, int SortOrder);

public record CreateCompanyBankAccountRequest(
    string BankName, string? AccountHolder = null, string? Iban = null,
    string? SwiftBic = null, bool IsDefault = false);

public record UpdateCompanyBankAccountRequest(
    string? BankName = null, string? AccountHolder = null, string? Iban = null,
    string? SwiftBic = null, bool? IsDefault = null);

public record UpdateCompanyProfileRequest(
    string? Name = null,
    string? TradingName = null,
    string? BusinessNumber = null,
    string? FiscalNumber = null,
    string? VatNumber = null,
    int? LegalForm = null,
    string? BusinessActivity = null,
    string? Description = null,
    // Address
    string? Country = null,
    string? Municipality = null,
    string? StreetAddress = null,
    string? PostalCode = null,
    string? AddressLine2 = null,
    // Contact
    string? Email = null,
    string? Phone = null,
    string? Website = null,
    // Banking
    string? BankName = null,
    string? BankAccountHolder = null,
    string? Iban = null,
    string? SwiftBic = null,
    // Document
    string? DocumentFooter = null,
    string? PaymentInstructions = null,
    // Tax
    bool? IsVatRegistered = null,
    DateOnly? VatRegistrationDate = null);

// B4: LockDateField excludes HardLockDate by construction — the same enum backs both "which soft
// lock to set" and "which soft lock this exception is for", so a hard-lock exception is
// structurally impossible to request, not just refused after the fact.
public record SetSoftLockRequest(LockDateField LockDateField, DateOnly? LockDate);

public record SetHardLockRequest(DateOnly LockDate);

public record GrantLockExceptionRequest(Guid UserId, LockDateField LockDateField, DateOnly LockDate, string Reason, DateTime EndsAt);

public record AccountLockExceptionResponse(
    Guid Id, Guid UserId, LockDateField LockDateField, DateOnly LockDate, string Reason,
    DateTime EndsAt, DateTime CreatedAt, Guid GrantedByUserId, DateTime? RevokedAt, Guid? RevokedByUserId, bool IsLive);
