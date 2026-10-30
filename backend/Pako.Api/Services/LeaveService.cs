using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Api.Services.Notifications;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Services;

public record LeaveResult(LeaveRequest? Leave, string? Error)
{
    public static LeaveResult Fail(string error) => new(null, error);
}

// Leave rules shared by the HR screens (LeaveController) and employee self-service (MeController):
// request validation, balances, decisions, and the notifications each step sends.
public class LeaveService
{
    private readonly PakoDbContext _db;
    private readonly NotificationOutbox _outbox;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public LeaveService(PakoDbContext db, NotificationOutbox outbox, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _outbox = outbox;
        _localizer = localizer;
    }

    public async Task<LeaveResult> CreateAsync(Guid companyId, CreateLeaveRequestRequest request)
    {
        await EnsureDefaultsAsync(companyId);

        if (request.EndDate < request.StartDate) return LeaveResult.Fail(_localizer["LeaveEndBeforeStart"].Value);
        var employee = await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == request.EmployeeId && e.CompanyId == companyId);
        if (employee is null) return LeaveResult.Fail(_localizer["EmployeeNotFound"].Value);

        var type = await _db.LeaveTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == request.LeaveTypeId && t.CompanyId == companyId);
        if (type is null) return LeaveResult.Fail(_localizer["LeaveTypeNotFound"].Value);

        var holidays = await HolidaySetAsync(companyId, request.StartDate, request.EndDate);
        var days = WorkingDays.Count(request.StartDate, request.EndDate, holidays);
        if (days == 0) return LeaveResult.Fail(_localizer["LeaveNoWorkingDays"].Value);

        if (await _db.LeaveRequests.AnyAsync(r => r.EmployeeId == request.EmployeeId &&
                (r.State == LeaveRequestState.Pending || r.State == LeaveRequestState.Approved) &&
                r.StartDate <= request.EndDate && r.EndDate >= request.StartDate))
        {
            return LeaveResult.Fail(_localizer["LeaveOverlaps"].Value);
        }

        var balance = (await ComputeBalancesAsync(companyId, request.StartDate.Year, request.EmployeeId))
            .FirstOrDefault(b => b.LeaveTypeId == type.Id);
        if (balance is not null && days > balance.Remaining)
        {
            return LeaveResult.Fail(string.Format(_localizer["LeaveExceedsBalance"], days, balance.Remaining));
        }

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            EmployeeId = request.EmployeeId,
            LeaveTypeId = type.Id,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            Days = days,
            Reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim()
        };
        _db.LeaveRequests.Add(leave);

        await _outbox.EnqueueAsync(companyId, NotificationTemplates.LeaveSubmitted, await _outbox.LeaveApproversAsync(employee),
            Payload(employee.Name, type.Name, leave, ("reason", leave.Reason ?? "—")));

        await _db.SaveChangesAsync();
        return new LeaveResult(leave, null);
    }

    public async Task<LeaveResult> DecideAsync(LeaveRequest leave, bool approve, Guid userId)
    {
        if (leave.State != LeaveRequestState.Pending) return LeaveResult.Fail(_localizer["LeaveRequestNotPending"].Value);

        leave.Decide(approve, userId);

        var employee = await _db.Employees.AsNoTracking().FirstAsync(e => e.Id == leave.EmployeeId);
        var typeName = await _db.LeaveTypes.AsNoTracking().Where(t => t.Id == leave.LeaveTypeId).Select(t => t.Name).FirstAsync();
        if (await _outbox.EmployeeAsync(employee) is { } recipient)
        {
            var decision = NotificationRenderer.Text(approve ? "Email_Decision_Approved" : "Email_Decision_Rejected", recipient.Culture);
            await _outbox.EnqueueAsync(leave.CompanyId, NotificationTemplates.LeaveDecided, new[] { recipient },
                Payload(employee.Name, typeName, leave, ("decision", decision)));
        }

        await _db.SaveChangesAsync();
        return new LeaveResult(leave, null);
    }

    public async Task<LeaveResult> CancelAsync(LeaveRequest leave)
    {
        try
        {
            leave.Cancel();
        }
        catch (InvalidOperationException ex)
        {
            return LeaveResult.Fail(ex.Message);
        }

        await _db.SaveChangesAsync();
        return new LeaveResult(leave, null);
    }

    private static Dictionary<string, string> Payload(string employee, string type, LeaveRequest leave, params (string Key, string Value)[] extra)
    {
        var payload = new Dictionary<string, string>
        {
            ["employee"] = employee,
            ["type"] = type,
            ["start"] = leave.StartDate.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture),
            ["end"] = leave.EndDate.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture),
            ["days"] = leave.Days.ToString("0.##", CultureInfo.InvariantCulture)
        };
        foreach (var (key, value) in extra) payload[key] = value;
        return payload;
    }

    // One row per (active employee, active leave type that tracks an entitlement).
    public async Task<List<LeaveBalanceResponse>> ComputeBalancesAsync(Guid companyId, int year, Guid? employeeId, DateOnly? asOf = null)
    {
        var today = asOf ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var employees = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.IsActive && (employeeId == null || e.Id == employeeId))
            .OrderBy(e => e.Name)
            .ToListAsync();
        var types = await _db.LeaveTypes.AsNoTracking().Where(t => t.CompanyId == companyId && t.IsActive).OrderBy(t => t.Code).ToListAsync();
        var allocations = await _db.LeaveAllocations.AsNoTracking().Where(a => a.CompanyId == companyId && a.Year == year).ToListAsync();
        var requests = await _db.LeaveRequests.AsNoTracking()
            .Where(r => r.CompanyId == companyId && r.StartDate.Year == year &&
                (r.State == LeaveRequestState.Approved || r.State == LeaveRequestState.Pending))
            .ToListAsync();

        var result = new List<LeaveBalanceResponse>();
        foreach (var employee in employees)
        {
            foreach (var type in types)
            {
                var allocation = allocations.FirstOrDefault(a => a.EmployeeId == employee.Id && a.LeaveTypeId == type.Id);
                if (allocation is null && type.DefaultAnnualDays is null)
                {
                    continue;
                }

                var ofType = requests.Where(r => r.EmployeeId == employee.Id && r.LeaveTypeId == type.Id).ToList();
                var taken = ofType.Where(r => r.State == LeaveRequestState.Approved).Sum(r => r.Days);
                var pending = ofType.Where(r => r.State == LeaveRequestState.Pending).Sum(r => r.Days);
                var carried = allocation?.CarriedOverDays ?? 0m;
                var allocated = (allocation?.EntitlementDays(type) ?? type.DefaultAnnualDays ?? 0m) + carried;
                var expired = LeaveCarryOver.Expired(carried, allocation?.CarriedOverExpiresOn, today,
                    ofType.Where(r => r.State == LeaveRequestState.Approved).Select(r => (r.StartDate, r.Days)));
                result.Add(new LeaveBalanceResponse(employee.Id, employee.Name, type.Id, type.Name, year, allocated, taken, pending,
                    allocated - taken - pending - expired, allocation?.HasCustomDays == true, carried, expired,
                    allocation?.CarriedOverExpiresOn));
            }
        }

        return result;
    }

    // Year-end carry-over for one company (or every company when companyId is null). Returns how
    // many next-year allocations received carried days.
    public async Task<int> CarryOverAsync(Guid? companyId, int fromYear)
    {
        var companyIds = companyId is { } id
            ? new List<Guid> { id }
            : await _db.LeaveTypes.AsNoTracking().Where(t => t.CarryOverMaxDays > 0m).Select(t => t.CompanyId).Distinct().ToListAsync();

        var updated = 0;
        foreach (var company in companyIds)
        {
            var types = await _db.LeaveTypes.AsNoTracking()
                .Where(t => t.CompanyId == company && t.IsActive && t.CarryOverMaxDays > 0m)
                .ToDictionaryAsync(t => t.Id);
            if (types.Count == 0) continue;

            // Balances as at the end of the year being closed.
            var balances = (await ComputeBalancesAsync(company, fromYear, null, new DateOnly(fromYear, 12, 31)))
                .Where(b => types.ContainsKey(b.LeaveTypeId) && b.Remaining > 0m)
                .ToList();
            var nextYear = fromYear + 1;
            var existing = await _db.LeaveAllocations.Where(a => a.CompanyId == company && a.Year == nextYear).ToListAsync();

            foreach (var balance in balances)
            {
                var type = types[balance.LeaveTypeId];
                var allocation = existing.FirstOrDefault(a => a.EmployeeId == balance.EmployeeId && a.LeaveTypeId == type.Id);
                if (allocation?.CarriedOverDays is not null) continue;

                if (allocation is null)
                {
                    allocation = new LeaveAllocation
                    {
                        Id = Guid.NewGuid(),
                        CompanyId = company,
                        EmployeeId = balance.EmployeeId,
                        LeaveTypeId = type.Id,
                        Year = nextYear,
                        Days = type.DefaultAnnualDays ?? 0m,
                        HasCustomDays = false
                    };
                    _db.LeaveAllocations.Add(allocation);
                }

                allocation.CarriedOverDays = Math.Min(balance.Remaining, type.CarryOverMaxDays!.Value);
                allocation.CarriedOverExpiresOn = type.CarryOverExpiryMonth is { } month
                    ? new DateOnly(nextYear, month, DateTime.DaysInMonth(nextYear, month))
                    : null;
                updated++;
            }

            await _db.SaveChangesAsync();
        }

        return updated;
    }

    public async Task<List<LeaveRequestResponse>> ToResponsesAsync(Guid companyId, List<LeaveRequest> requests)
    {
        var employeeIds = requests.Select(r => r.EmployeeId).Distinct().ToList();
        var names = await _db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.Name);
        var types = await _db.LeaveTypes.AsNoTracking().Where(t => t.CompanyId == companyId).ToDictionaryAsync(t => t.Id, t => t.Name);

        return requests.Select(r => new LeaveRequestResponse(
            r.Id, r.EmployeeId, names.GetValueOrDefault(r.EmployeeId, string.Empty), r.LeaveTypeId,
            types.GetValueOrDefault(r.LeaveTypeId, string.Empty), r.StartDate, r.EndDate, r.Days, r.Reason,
            r.State.ToString(), r.DecidedAt, r.CreatedAt)).ToList();
    }

    public async Task<IReadOnlySet<DateOnly>> HolidaySetAsync(Guid companyId, DateOnly from, DateOnly to) =>
        (await _db.PublicHolidays.AsNoTracking()
            .Where(h => h.CompanyId == companyId && h.Date >= from && h.Date <= to)
            .Select(h => h.Date)
            .ToListAsync()).ToHashSet();

    // Seeds the Kosovo leave types and holiday calendar once per company. A company that has
    // edited or deleted them is never re-seeded: the check is "any rows at all", not per row.
    public async Task EnsureDefaultsAsync(Guid companyId)
    {
        var changed = false;
        if (!await _db.LeaveTypes.AnyAsync(t => t.CompanyId == companyId))
        {
            _db.LeaveTypes.AddRange(KosovoPayrollRules.LeaveTypes.Select(t => new LeaveType
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Code = t.Code,
                Name = t.NameSq,
                DefaultAnnualDays = t.DefaultAnnualDays,
                PayPercent = t.PayPercent
            }));
            changed = true;
        }

        if (!await _db.PublicHolidays.AnyAsync(h => h.CompanyId == companyId))
        {
            _db.PublicHolidays.AddRange(KosovoPayrollRules.PublicHolidays.Select(h => new PublicHoliday
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Date = h.Date,
                Name = h.NameSq
            }));
            changed = true;
        }

        if (changed)
        {
            await _db.SaveChangesAsync();
        }
    }
}
