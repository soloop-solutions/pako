namespace Pako.Api.Contracts;

public record CostCenterResponse(Guid Id, string Code, string Name, string NameEn);

public record SaveCostCenterRequest(string Code, string Name, string? NameEn);
