using Pako.Domain.Hr;

namespace Pako.Api.Contracts;

// ---- docs/USER_ACCESS_PLAN.md: the administration dashboard (users, invitations, roles) ----

public record CompanyRoleResponse(
    Guid Id,
    string Name,
    string? Description,
    // Seeded template key ("accountant", "sales"…); null for roles the admin created.
    string? BuiltInKey,
    ModuleAccessResponse Levels,
    PartnerScope PartnerScope,
    int UserCount);

public record SaveCompanyRoleRequest(string Name, string? Description, ModuleAccessResponse Levels, PartnerScope PartnerScope);

// One row of the users list: an active or deactivated member, or a pending invitation. Firm
// members (admins/accountants of the accounting firm) are listed but managed at the firm.
public record CompanyUserResponse(
    Guid? MembershipId,
    Guid? InvitationId,
    Guid? UserId,
    string Email,
    string? FullName,
    // Administrator, Role, ReadOnly (legacy viewer), FirmAdmin, FirmAccountant.
    string Access,
    Guid? RoleId,
    string? RoleName,
    Guid? EmployeeId,
    string? EmployeeName,
    // Active, Deactivated, Invited, Expired.
    string Status,
    DateTime? LastLoginAt,
    DateTime? InvitedAt,
    bool IsFirmMember,
    bool IsYou);

public record InviteUserRequest(string Email, string? FullName, bool Administrator, Guid? RoleId, Guid? EmployeeId);

// The link is returned so the admin can share it even before email is configured.
public record InvitationCreatedResponse(CompanyUserResponse User, string InviteUrl, DateTime ExpiresAt);

public record UpdateCompanyUserRequest(bool Administrator, Guid? RoleId, Guid? EmployeeId);

public record PasswordResetLinkResponse(string ResetUrl);

// ---- Public (anonymous) invitation and password flows ----

public record InvitationInfoResponse(string CompanyName, string Email, string? FullName, bool AccountExists, bool IsValid);

public record AcceptInvitationRequest(string Token, string? FullName, string Password);

public record ForgotPasswordRequest(string Email);

public record ResetPasswordRequest(string Email, string Token, string NewPassword);
