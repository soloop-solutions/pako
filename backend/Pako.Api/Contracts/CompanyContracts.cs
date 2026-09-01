using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

// EnabledProfiles omitted/null seeds CORE only (Company.EnabledProfiles' own default) — CORE is
// always included regardless of what's passed, per 50_Profiles.
public record CreateCompanyRequest(string Name, Guid? FirmId = null, CompanyProfile? EnabledProfiles = null);
public record CompanyResponse(Guid Id, string Name, Guid? FirmId, DateOnly? AccountingLockDate, DateOnly? TaxLockDate, CompanyProfile EnabledProfiles);
