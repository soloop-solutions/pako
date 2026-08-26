namespace Pako.Api.Contracts;

public record CreateFirmRequest(string Name);
public record FirmResponse(Guid Id, string Name);
