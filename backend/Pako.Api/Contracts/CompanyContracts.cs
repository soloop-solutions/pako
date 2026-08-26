namespace Pako.Api.Contracts;

public record CreateCompanyRequest(string Name, Guid? FirmId = null);
public record CompanyResponse(Guid Id, string Name, Guid? FirmId, DateOnly? AccountingLockDate, DateOnly? TaxLockDate);
