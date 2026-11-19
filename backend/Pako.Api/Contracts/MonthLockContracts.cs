using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

public record MonthLockResponse(
    int Year,
    int Month,
    bool IsLocked,
    Guid? LockedByUserId,
    string? LockedByEmail,
    DateTime? LockedAt);

public record MonthLockYearResponse(int Year, List<MonthLockResponse> Months);

public record LockMonthsRequest(int Year, int[] Months);

public record UnlockMonthRequest(int Year, int Month, string Reason);

public record MonthLockEventResponse(
    Guid Id,
    int Year,
    int Month,
    MonthLockAction Action,
    Guid UserId,
    string? UserEmail,
    DateTime Timestamp,
    string? Reason);

public record MonthLockHistoryResponse(
    List<MonthLockEventResponse> Items,
    int Total,
    int Page,
    int PageSize);
