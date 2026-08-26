using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

public record AddMemberRequest(string Email, MembershipRole Role);
public record MemberResponse(Guid MembershipId, Guid UserId, string Email, MembershipRole Role);
