namespace Pako.Api.Contracts;

// docs/PLATFORM_ADMIN.md — platform administration (above every company) and account requests.

public record AccountRequestRequest(
    string FullName, string Email, string? Phone, string? FirmName, string? BusinessNumber, string? City,
    int RequestedCompanies, string? Message);

public record MyAccountResponse(
    Guid UserId, string Email, string? FullName, bool IsPlatformAdmin, int? CompanyLimit, int CompaniesCreated);

public record AccountRequestResponse(
    Guid Id, string FullName, string Email, string? Phone, string? FirmName, string? BusinessNumber, string? City,
    int RequestedCompanies, string? Message, string Status, DateTime CreatedAt, DateTime? DecidedAt,
    string? DecisionNote, string? DecidedBy);

public record ApproveAccountRequestRequest(int? CompanyLimit, string? Note);

public record ApproveAccountRequestResponse(AccountRequestResponse Request, Guid UserId, string SetPasswordUrl);

public record RejectAccountRequestRequest(string? Note);

public record PlatformUserResponse(
    Guid Id, string Email, string? FullName, bool IsPlatformAdmin, bool IsDisabled, int? CompanyLimit,
    int CompaniesCreated, int CompanyAccessCount, DateTime CreatedAt, DateTime? LastLoginAt);

// CompanyLimit null = no limit.
public record UpdatePlatformUserRequest(int? CompanyLimit, bool IsDisabled, bool IsPlatformAdmin);

// Modules: "sales", "purchases", "accounting", "reports", "hr", "payroll".
public record PlatformCompanyResponse(
    Guid Id, string Name, string? BusinessNumber, Guid? CreatedByUserId, string? CreatedByEmail, List<string> Modules,
    bool IsArchived, DateTime CreatedAt, int Users, int PostedInvoices, int PostedBills, int Employees, DateTime? LastActivity);

public record UpdateCompanyModulesRequest(List<string> Modules);

public record AccountantUsageResponse(
    Guid UserId, string Email, string? FullName, bool IsDisabled, bool IsPlatformAdmin, int? CompanyLimit, int CompaniesCreated, int TeamMembers,
    int PostedInvoices, int InvoicesLast30Days, int PostedBills, int Employees, int PayrollRuns,
    DateTime? LastLoginAt, DateTime? LastActivity);

public record PlatformOverviewResponse(
    int Users, int AccountantCount, int PlatformAdmins, int DisabledUsers, int Companies, int PendingRequests,
    int InvoicesLast30Days, int ActiveUsersLast30Days, List<AccountantUsageResponse> Accountants);

// One platform administration action. Action: ApproveRequest, RejectRequest, UpdateUser, UpdateModules.
// Details is JSON ({ before, after } or { note }).
public record PlatformAuditResponse(
    Guid Id, DateTime OccurredAt, string? ActorEmail, string Action, string TargetType, Guid TargetId, string TargetLabel, string? Details);
