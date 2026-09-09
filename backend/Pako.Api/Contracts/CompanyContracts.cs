using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

// EnabledProfiles omitted/null seeds CORE only (Company.EnabledProfiles' own default) — CORE is
// always included regardless of what's passed, per 50_Profiles. IsVatRegistered omitted/null
// defaults to true (Company.IsVatRegistered's own default) — see C2 (tax-enums.ts / CLAUDE.md)
// for why a genuinely-empty "no tax" choice is only ever valid once this is false.
public record CreateCompanyRequest(string Name, Guid? FirmId = null, CompanyProfile? EnabledProfiles = null, bool? IsVatRegistered = null);
public record CompanyResponse(Guid Id, string Name, Guid? FirmId, DateOnly? AccountingLockDate, DateOnly? TaxLockDate, CompanyProfile EnabledProfiles, bool IsVatRegistered);
