using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Notifications;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Services.Notifications;

// E8: a job that runs at most once per calendar day (UTC), on the days IsDue says.
public interface IScheduledJob
{
    string Name { get; }
    bool IsDue(DateOnly today);
    Task RunAsync(DateOnly today, CancellationToken cancellationToken);
}

public class JobLockService
{
    private readonly PakoDbContext _db;

    public JobLockService(PakoDbContext db)
    {
        _db = db;
    }

    // True for exactly one caller per (job, day): the conditional upsert only writes when the
    // stored LastRunOn is older than today, and Postgres serialises the competing upserts.
    public async Task<bool> TryClaimAsync(string name, DateOnly today, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var affected = await _db.Database.ExecuteSqlAsync($"""
            INSERT INTO job_locks ("Name", "LastRunOn", "LastRunAt") VALUES ({name}, {today}, {now})
            ON CONFLICT ("Name") DO UPDATE SET "LastRunOn" = EXCLUDED."LastRunOn", "LastRunAt" = EXCLUDED."LastRunAt"
            WHERE job_locks."LastRunOn" IS NULL OR job_locks."LastRunOn" < EXCLUDED."LastRunOn"
            """, cancellationToken);
        return affected == 1;
    }
}

// Reminds the HR team every day from the 10th until the EDI deadline (the 15th, rolled past
// weekends and holidays — EdiDeadline) while last month's payroll is not posted.
public class EdiDeadlineReminderJob : IScheduledJob
{
    private readonly PakoDbContext _db;
    private readonly NotificationOutbox _outbox;

    public EdiDeadlineReminderJob(PakoDbContext db, NotificationOutbox outbox)
    {
        _db = db;
        _outbox = outbox;
    }

    public string Name => "EdiDeadlineReminder";

    // The latest a rolled deadline can land is a few days after the 15th (a weekend plus a holiday).
    public bool IsDue(DateOnly today) => today.Day is >= 10 and <= 20;

    public async Task RunAsync(DateOnly today, CancellationToken cancellationToken)
    {
        var periodStart = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
        var periodEnd = periodStart.AddMonths(1).AddDays(-1);
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);

        var companies = await _db.Companies.AsNoTracking()
            .Where(c => !c.IsArchived && _db.Employees.Any(e => e.CompanyId == c.Id && e.IsActive &&
                (e.HireDate == null || e.HireDate <= periodEnd) && (e.TerminationDate == null || e.TerminationDate >= periodStart)))
            .Where(c => !_db.PayrollRuns.Any(r => r.CompanyId == c.Id && r.PeriodStart <= periodStart && r.PeriodEnd >= periodEnd &&
                (r.State == PayrollRunState.Posted || r.State == PayrollRunState.Paid)))
            .Select(c => new { c.Id, c.Name })
            .ToListAsync(cancellationToken);

        foreach (var company in companies)
        {
            var holidays = (await _db.PublicHolidays.AsNoTracking()
                    .Where(h => h.CompanyId == company.Id && h.Date >= monthStart && h.Date <= monthEnd)
                    .Select(h => h.Date)
                    .ToListAsync(cancellationToken))
                .ToHashSet();
            var due = EdiDeadline.DueDate(periodStart, holidays);
            if (today > due) continue;

            await _outbox.EnqueueAsync(company.Id, NotificationTemplates.EdiDeadline, await _outbox.HrTeamAsync(company.Id),
                new Dictionary<string, string>
                {
                    ["company"] = company.Name,
                    ["month"] = periodStart.ToString("MM.yyyy", CultureInfo.InvariantCulture),
                    ["dueDate"] = due.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture),
                    ["daysLeft"] = (due.DayNumber - today.DayNumber).ToString(CultureInfo.InvariantCulture)
                });
        }

        await _db.SaveChangesAsync(cancellationToken);
    }
}

// I14: every Monday, each firm's admins and accountants get last month's payroll status across
// their clients — sent only while some client is not posted yet.
public class FirmPayrollDigestJob : IScheduledJob
{
    private readonly PakoDbContext _db;
    private readonly NotificationOutbox _outbox;
    private readonly FirmPayrollService _overview;

    public FirmPayrollDigestJob(PakoDbContext db, NotificationOutbox outbox, FirmPayrollService overview)
    {
        _db = db;
        _outbox = outbox;
        _overview = overview;
    }

    public string Name => "FirmPayrollDigest";

    public bool IsDue(DateOnly today) => today.DayOfWeek == DayOfWeek.Monday;

    public async Task RunAsync(DateOnly today, CancellationToken cancellationToken)
    {
        var month = today.AddMonths(-1);
        var firmIds = await _db.Firms.AsNoTracking().Select(f => f.Id).ToListAsync(cancellationToken);
        foreach (var firmId in firmIds)
        {
            var overview = await _overview.OverviewAsync(firmId, month, today);
            if (overview is null || overview.Companies.All(c => c.Status == "Done")) continue;

            var memberIds = await _db.Memberships.AsNoTracking()
                .Where(m => m.FirmId == firmId && m.IsActive && (m.Role == MembershipRole.FirmAdmin || m.Role == MembershipRole.FirmAccountant))
                .Select(m => m.UserId)
                .ToListAsync(cancellationToken);
            var recipients = await _db.Users.AsNoTracking()
                .Where(u => memberIds.Contains(u.Id) && u.Email != null)
                .Select(u => new NotificationRecipient(u.Email!, NotificationOutbox.DefaultCulture))
                .ToListAsync(cancellationToken);

            await _outbox.EnqueueLocalizedAsync(null, NotificationTemplates.FirmPayrollDigest, recipients, culture => new Dictionary<string, string>
            {
                ["firm"] = overview.FirmName,
                ["month"] = overview.Month.ToString("MM.yyyy", CultureInfo.InvariantCulture),
                ["dueDate"] = overview.Companies.Select(c => c.EdiDueDate).DefaultIfEmpty(EdiDeadline.DueDate(overview.Month, new HashSet<DateOnly>()))
                    .Min().ToString("dd.MM.yyyy", CultureInfo.InvariantCulture),
                ["summary"] = string.Join("\n", overview.Companies
                    .OrderBy(c => c.Status switch { "Overdue" => 0, "DueSoon" => 1, "Open" => 2, _ => 3 })
                    .Select(c => $"• {c.CompanyName}: {NotificationRenderer.Text("Email_PayrollStatus_" + c.Status, culture)}" +
                        (c.RunState is null ? $" ({NotificationRenderer.Text("Email_PayrollStatus_NoRun", culture)})" : $" ({c.RunState})")))
            });
        }

        await _db.SaveChangesAsync(cancellationToken);
    }
}

// Fixed-term contracts ending in 30 days, and probation periods ending in 14 days.
public class ContractRemindersJob : IScheduledJob
{
    public const int ContractDaysAhead = 30;
    public const int ProbationDaysAhead = 14;

    private readonly PakoDbContext _db;
    private readonly NotificationOutbox _outbox;

    public ContractRemindersJob(PakoDbContext db, NotificationOutbox outbox)
    {
        _db = db;
        _outbox = outbox;
    }

    public string Name => "ContractReminders";

    public bool IsDue(DateOnly today) => true;

    public async Task RunAsync(DateOnly today, CancellationToken cancellationToken)
    {
        var contractDay = today.AddDays(ContractDaysAhead);
        var probationDay = today.AddDays(ProbationDaysAhead);

        var rows = await (
            from c in _db.EmployeeContracts.AsNoTracking()
            join e in _db.Employees.AsNoTracking() on c.EmployeeId equals e.Id
            where e.IsActive && (c.EndDate == contractDay || c.ProbationEndDate == probationDay)
            select new { Contract = c, Employee = e }).ToListAsync(cancellationToken);

        foreach (var row in rows)
        {
            var hr = await _outbox.HrTeamAsync(row.Employee.CompanyId);
            if (row.Contract.EndDate == contractDay)
            {
                await _outbox.EnqueueAsync(row.Employee.CompanyId, NotificationTemplates.ContractEnding, hr, new Dictionary<string, string>
                {
                    ["employee"] = row.Employee.Name,
                    ["endDate"] = contractDay.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture)
                });
            }

            if (row.Contract.ProbationEndDate == probationDay)
            {
                var recipients = hr.Concat(await _outbox.LeaveApproversAsync(row.Employee)).ToList();
                await _outbox.EnqueueAsync(row.Employee.CompanyId, NotificationTemplates.ProbationEnding, recipients, new Dictionary<string, string>
                {
                    ["employee"] = row.Employee.Name,
                    ["endDate"] = probationDay.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture)
                });
            }
        }

        await _db.SaveChangesAsync(cancellationToken);
    }
}

// F9: closes last year's leave in the first week of January (a week, not one day, so a server
// that was down on the 1st still runs it; the carry-over itself is idempotent).
public class LeaveCarryOverJob : IScheduledJob
{
    private readonly LeaveService _leave;

    public LeaveCarryOverJob(LeaveService leave)
    {
        _leave = leave;
    }

    public string Name => "LeaveCarryOver";

    public bool IsDue(DateOnly today) => today is { Month: 1, Day: <= 7 };

    public Task RunAsync(DateOnly today, CancellationToken cancellationToken) => _leave.CarryOverAsync(null, today.Year - 1);
}

// Runs the outbox every minute and each scheduled job once on the days it is due. Each tick gets
// its own DI scope (fresh DbContext); a failing job is logged and never stops the loop.
public class BackgroundJobsHostedService : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromMinutes(1);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<BackgroundJobsHostedService> _logger;

    public BackgroundJobsHostedService(IServiceScopeFactory scopes, ILogger<BackgroundJobsHostedService> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let migrations and startup finish first.
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
        using var timer = new PeriodicTimer(Tick);
        do
        {
            await RunOnceAsync(stoppingToken);
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        using (var scope = _scopes.CreateScope())
        {
            var jobNames = scope.ServiceProvider.GetServices<IScheduledJob>().Select(j => j.Name).ToList();
            foreach (var name in jobNames)
            {
                // A scope per job: one job's failed SaveChanges must not poison the next one's context.
                using var jobScope = _scopes.CreateScope();
                var job = jobScope.ServiceProvider.GetServices<IScheduledJob>().First(j => j.Name == name);
                try
                {
                    if (!job.IsDue(today)) continue;
                    if (!await jobScope.ServiceProvider.GetRequiredService<JobLockService>().TryClaimAsync(job.Name, today, stoppingToken)) continue;
                    _logger.LogInformation("Running scheduled job {Job} for {Day}", job.Name, today);
                    await job.RunAsync(today, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(ex, "Scheduled job {Job} failed", job.Name);
                }
            }
        }

        try
        {
            using var scope = _scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<NotificationDispatcher>().DeliverDueAsync(DateTime.UtcNow, stoppingToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Notification dispatch failed");
        }
    }
}
