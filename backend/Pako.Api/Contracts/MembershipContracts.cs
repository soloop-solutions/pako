using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

// EmployeeId is required for ClientStaff (it links the login to the employee whose department
// decides the access) and ignored for every other role.
public record AddMemberRequest(string Email, MembershipRole Role, Guid? EmployeeId = null);
public record MemberResponse(Guid MembershipId, Guid UserId, string Email, MembershipRole Role);
