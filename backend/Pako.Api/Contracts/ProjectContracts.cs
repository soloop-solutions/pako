namespace Pako.Api.Contracts;

public record CreateProjectRequest(string Code, string Name);

public record UpdateProjectRequest(string Name, bool IsActive);

public record ProjectResponse(Guid Id, string Code, string Name, bool IsActive);
