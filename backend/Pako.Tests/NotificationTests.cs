using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

// E7/E8 on real Postgres: the outbox claim (FOR UPDATE SKIP LOCKED) and the job lock (conditional
// upsert) are exactly the things EF InMemory could never prove.
public class NotificationTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private sealed class RecordingSender : IEmailSender
    {
        public List<EmailMessage> Sent { get; } = new();
        public Exception? FailWith { get; set; }

        public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
        {
            if (FailWith is not null) throw FailWith;
            lock (Sent) Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    private async Task<(PakoDbContext Db, Guid CompanyId)> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return (db, company.Id);
    }

    private PakoDbContext Another(PakoDbContext db)
    {
        var other = PostgresTestDatabase.CreateAdditionalContext(db);
        _contexts.Add(other);
        return other;
    }

    private static async Task<Guid> AddUserAsync(PakoDbContext db, string email)
    {
        var user = new AppUser { Id = Guid.NewGuid(), Email = email, UserName = email, NormalizedEmail = email.ToUpperInvariant(), NormalizedUserName = email.ToUpperInvariant() };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private static Employee NewEmployee(Guid companyId, string name, string? email = null, Guid? managerId = null, string language = "sq") => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = companyId,
        Name = name,
        Email = email,
        ManagerId = managerId,
        MonthlyGrossSalary = 1000m,
        PreferredLanguage = language
    };

    private static NotificationDispatcher Dispatcher(PakoDbContext db, IEmailSender sender) =>
        new(db, sender, new NotificationRenderer(Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" })),
            new PayslipDocumentService(db), NullLogger<NotificationDispatcher>.Instance);

    private static LeaveService Leave(PakoDbContext db) => new(db, new NotificationOutbox(db), new NullStringLocalizer<ErrorMessages>());

    private static Dictionary<string, string> P(Notification n) =>
        System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(n.PayloadJson)!;

    private static readonly Dictionary<string, string> Payload = new() { ["company"] = "Test Co" };

    // ---- Outbox ----

    [Fact]
    public async Task Enqueue_TemplateSwitchedOff_QueuesNothing()
    {
        var (db, companyId) = await SeedAsync();
        db.CompanyNotificationSettings.Add(new CompanyNotificationSetting { CompanyId = companyId, Template = NotificationTemplates.StaffInvitation, Enabled = false });
        await db.SaveChangesAsync();

        var outbox = new NotificationOutbox(db);
        await outbox.EnqueueAsync(companyId, NotificationTemplates.StaffInvitation, new[] { new NotificationRecipient("a@x.test", "sq") }, Payload);
        await outbox.EnqueueAsync(companyId, NotificationTemplates.EdiDeadline, new[] { new NotificationRecipient("a@x.test", "sq") }, Payload);
        await db.SaveChangesAsync();

        Assert.Equal(NotificationTemplates.EdiDeadline, Assert.Single(await db.Notifications.ToListAsync()).Template);
    }

    [Fact]
    public async Task Enqueue_DedupesAddresses_AndDropsBlankOnes()
    {
        var (db, companyId) = await SeedAsync();
        var outbox = new NotificationOutbox(db);

        await outbox.EnqueueAsync(companyId, NotificationTemplates.EdiDeadline, new[]
        {
            new NotificationRecipient("HR@x.test", "sq"),
            new NotificationRecipient("hr@x.test ", "en"),
            new NotificationRecipient("", "sq"),
            new NotificationRecipient("not-an-email", "sq"),
        }, Payload);
        await db.SaveChangesAsync();

        Assert.Equal("HR@x.test", Assert.Single(await db.Notifications.ToListAsync()).RecipientEmail);
    }

    // ---- Dispatcher ----

    [Fact]
    public async Task Dispatch_SendsInRecipientLanguage_AndMarksSent()
    {
        var (db, companyId) = await SeedAsync();
        var outbox = new NotificationOutbox(db);
        await outbox.EnqueueAsync(companyId, NotificationTemplates.StaffInvitation, new[] { new NotificationRecipient("sq@x.test", "sq") }, Payload);
        await outbox.EnqueueAsync(companyId, NotificationTemplates.StaffInvitation, new[] { new NotificationRecipient("en@x.test", "en") }, Payload);
        await db.SaveChangesAsync();
        var sender = new RecordingSender();

        Assert.Equal(2, await Dispatcher(db, sender).DeliverDueAsync(DateTime.UtcNow));

        Assert.Equal("Tani keni qasje në Test Co në PAKO", sender.Sent.Single(m => m.To == "sq@x.test").Subject);
        var english = sender.Sent.Single(m => m.To == "en@x.test");
        Assert.Equal("You now have access to Test Co in PAKO", english.Subject);
        Assert.Contains("https://app.test/login", english.TextBody);
        Assert.All(await db.Notifications.AsNoTracking().ToListAsync(), n => Assert.Equal(NotificationState.Sent, n.State));

        // Nothing left to send.
        Assert.Equal(0, await Dispatcher(db, sender).DeliverDueAsync(DateTime.UtcNow));
    }

    [Fact]
    public async Task Dispatch_FailingSender_BacksOffAndGivesUpAfterMaxAttempts()
    {
        var (db, companyId) = await SeedAsync();
        await new NotificationOutbox(db).EnqueueAsync(companyId, NotificationTemplates.EdiDeadline, new[] { new NotificationRecipient("a@x.test", "sq") }, Payload);
        await db.SaveChangesAsync();
        var sender = new RecordingSender { FailWith = new InvalidOperationException("SMTP down") };

        var now = DateTime.UtcNow;
        await Dispatcher(db, sender).DeliverDueAsync(now);
        var row = await db.Notifications.AsNoTracking().SingleAsync();
        Assert.Equal(1, row.Attempts);
        Assert.Equal(NotificationState.Pending, row.State);
        Assert.Equal("SMTP down", row.LastError);

        // Not due again straight away (1-minute backoff).
        Assert.Empty(await Dispatcher(db, sender).ClaimDueAsync(now.AddSeconds(30)));

        for (var i = 0; i < Notification.MaxAttempts; i++)
        {
            await Dispatcher(db, sender).DeliverDueAsync(now.AddDays(1 + i));
        }

        row = await db.Notifications.AsNoTracking().SingleAsync();
        Assert.Equal(NotificationState.Failed, row.State);
        Assert.Equal(Notification.MaxAttempts, row.Attempts);
    }

    [Fact]
    public async Task Dispatch_ConcurrentInstances_NeverClaimTheSameRow()
    {
        var (db, companyId) = await SeedAsync();
        var outbox = new NotificationOutbox(db);
        for (var i = 0; i < 50; i++)
        {
            await outbox.EnqueueAsync(companyId, NotificationTemplates.EdiDeadline, new[] { new NotificationRecipient($"u{i}@x.test", "sq") }, Payload);
        }

        await db.SaveChangesAsync();

        var now = DateTime.UtcNow.AddSeconds(1);
        var claims = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => Dispatcher(Another(db), new RecordingSender()).ClaimDueAsync(now)));

        var all = claims.SelectMany(c => c).ToList();
        Assert.Equal(all.Count, all.Distinct().Count());
        Assert.Equal(50, all.Count);
        Assert.All(claims, c => Assert.True(c.Count <= NotificationDispatcher.BatchSize));
    }

    // ---- Job lock ----

    [Fact]
    public async Task JobLock_OneWinnerPerDay_AcrossInstances()
    {
        var (db, _) = await SeedAsync();
        var today = new DateOnly(2026, 10, 10);

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => new JobLockService(Another(db)).TryClaimAsync("EdiDeadlineReminder", today)));
        Assert.Equal(1, results.Count(r => r));

        Assert.False(await new JobLockService(db).TryClaimAsync("EdiDeadlineReminder", today));
        Assert.True(await new JobLockService(db).TryClaimAsync("ContractReminders", today));
        Assert.True(await new JobLockService(db).TryClaimAsync("EdiDeadlineReminder", today.AddDays(1)));
    }

    // ---- Leave notifications ----

    [Fact]
    public async Task LeaveSubmitted_GoesToTheManager_DecisionGoesToTheEmployeeInTheirLanguage()
    {
        var (db, companyId) = await SeedAsync();
        var manager = NewEmployee(companyId, "Mira Manager", "mira@x.test");
        var employee = NewEmployee(companyId, "Arta Krasniqi", "arta@x.test", manager.Id, language: "en");
        db.Employees.AddRange(manager, employee);
        await db.SaveChangesAsync();
        await Leave(db).EnsureDefaultsAsync(companyId);
        var annual = await db.LeaveTypes.FirstAsync(t => t.CompanyId == companyId && t.DefaultAnnualDays != null);

        var created = await Leave(db).CreateAsync(companyId,
            new CreateLeaveRequestRequest(employee.Id, annual.Id, new DateOnly(2026, 11, 2), new DateOnly(2026, 11, 4), "Family"));
        Assert.NotNull(created.Leave);

        var submitted = Assert.Single(await db.Notifications.AsNoTracking().ToListAsync());
        Assert.Equal(NotificationTemplates.LeaveSubmitted, submitted.Template);
        Assert.Equal("mira@x.test", submitted.RecipientEmail);
        Assert.Equal("Family", P(submitted)["reason"]);

        await Leave(db).DecideAsync(created.Leave!, approve: true, Guid.NewGuid());

        var decided = await db.Notifications.AsNoTracking().SingleAsync(n => n.Template == NotificationTemplates.LeaveDecided);
        Assert.Equal("arta@x.test", decided.RecipientEmail);
        Assert.Equal("en", decided.Culture);
        Assert.Equal("approved", P(decided)["decision"]);
    }

    [Fact]
    public async Task LeaveSubmitted_NoReachableManager_GoesToTheHrTeam()
    {
        var (db, companyId) = await SeedAsync();
        var admin = await AddUserAsync(db, "admin@x.test");
        var viewer = await AddUserAsync(db, "viewer@x.test");
        var hrStaffUser = await AddUserAsync(db, "hr@x.test");
        db.Memberships.Add(Membership.ForCompany(admin, companyId, MembershipRole.ClientAdmin));
        db.Memberships.Add(Membership.ForCompany(viewer, companyId, MembershipRole.ClientViewer));
        // HR approvers are the users whose role has HR at Approve (docs/USER_ACCESS_PLAN.md).
        var hrRole = new CompanyRole { Id = Guid.NewGuid(), CompanyId = companyId, Name = "HR officer", HrAccess = AccessLevel.Approve };
        var clerkRole = new CompanyRole { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Clerk", HrAccess = AccessLevel.Write };
        db.CompanyRoles.AddRange(hrRole, clerkRole);
        var hrMembership = Membership.ForCompany(hrStaffUser, companyId, MembershipRole.ClientStaff);
        hrMembership.CompanyRoleId = hrRole.Id;
        var clerkUser = await AddUserAsync(db, "clerk@x.test");
        var clerkMembership = Membership.ForCompany(clerkUser, companyId, MembershipRole.ClientStaff);
        clerkMembership.CompanyRoleId = clerkRole.Id;
        db.Memberships.AddRange(hrMembership, clerkMembership);
        var hrStaff = NewEmployee(companyId, "Hana HR");
        hrStaff.UserId = hrStaffUser;
        var employee = NewEmployee(companyId, "Arta Krasniqi");
        db.Employees.AddRange(hrStaff, employee);
        await db.SaveChangesAsync();

        var recipients = await new NotificationOutbox(db).LeaveApproversAsync(employee);

        Assert.Equal(new[] { "admin@x.test", "hr@x.test" }, recipients.Select(r => r.Email).OrderBy(e => e));
    }

    // ---- Scheduled jobs ----

    [Fact]
    public async Task EdiReminder_RemindsOnlyCompaniesWhoseLastMonthIsNotPosted()
    {
        var (db, unposted) = await SeedAsync();
        var posted = new Company { Id = Guid.NewGuid(), Name = "Posted Co" };
        var empty = new Company { Id = Guid.NewGuid(), Name = "No staff Co" };
        db.Companies.AddRange(posted, empty);
        var admin = await AddUserAsync(db, "admin@x.test");
        db.Memberships.Add(Membership.ForCompany(admin, unposted, MembershipRole.ClientAdmin));
        db.Memberships.Add(Membership.ForCompany(admin, posted.Id, MembershipRole.ClientAdmin));
        db.Employees.AddRange(NewEmployee(unposted, "A"), NewEmployee(posted.Id, "B"));
        db.PayrollRuns.Add(new PayrollRun
        {
            Id = Guid.NewGuid(), CompanyId = posted.Id, PeriodStart = new DateOnly(2026, 9, 1), PeriodEnd = new DateOnly(2026, 9, 30),
            State = PayrollRunState.Posted
        });
        await db.SaveChangesAsync();

        var job = new EdiDeadlineReminderJob(db, new NotificationOutbox(db));
        Assert.False(job.IsDue(new DateOnly(2026, 10, 9)));
        Assert.True(job.IsDue(new DateOnly(2026, 10, 12)));
        await job.RunAsync(new DateOnly(2026, 10, 12), CancellationToken.None);

        var reminder = Assert.Single(await db.Notifications.AsNoTracking().ToListAsync());
        Assert.Equal(unposted, reminder.CompanyId);
        Assert.Equal("15.10.2026", P(reminder)["dueDate"]);
        Assert.Equal("3", P(reminder)["daysLeft"]);
    }

    [Fact]
    public async Task ContractReminders_ContractIn30Days_AndProbationIn14Days()
    {
        var (db, companyId) = await SeedAsync();
        var admin = await AddUserAsync(db, "admin@x.test");
        db.Memberships.Add(Membership.ForCompany(admin, companyId, MembershipRole.ClientAdmin));
        var ending = NewEmployee(companyId, "Ending");
        var probation = NewEmployee(companyId, "Probation");
        var other = NewEmployee(companyId, "Other");
        db.Employees.AddRange(ending, probation, other);
        var today = new DateOnly(2026, 10, 30);
        db.EmployeeContracts.AddRange(
            new EmployeeContract { Id = Guid.NewGuid(), CompanyId = companyId, EmployeeId = ending.Id, StartDate = new DateOnly(2026, 1, 1), EndDate = today.AddDays(30), MonthlyGrossSalary = 900m },
            new EmployeeContract { Id = Guid.NewGuid(), CompanyId = companyId, EmployeeId = probation.Id, StartDate = new DateOnly(2026, 8, 1), ProbationEndDate = today.AddDays(14), MonthlyGrossSalary = 900m },
            new EmployeeContract { Id = Guid.NewGuid(), CompanyId = companyId, EmployeeId = other.Id, StartDate = new DateOnly(2026, 1, 1), EndDate = today.AddDays(29), MonthlyGrossSalary = 900m });
        await db.SaveChangesAsync();

        await new ContractRemindersJob(db, new NotificationOutbox(db)).RunAsync(today, CancellationToken.None);

        var rows = await db.Notifications.AsNoTracking().OrderBy(n => n.Template).ToListAsync();
        Assert.Equal(new[] { NotificationTemplates.ContractEnding, NotificationTemplates.ProbationEnding }, rows.Select(r => r.Template));
        Assert.Equal("Ending", P(rows[0])["employee"]);
        Assert.Equal("Probation", P(rows[1])["employee"]);
    }

    // ---- I14 firm payroll dashboard ----

    [Fact]
    public void EdiDeadline_15thOfNextMonth_RolledPastWeekendsAndHolidays()
    {
        // September 2026 → 15 October 2026 is a Thursday.
        Assert.Equal(new DateOnly(2026, 10, 15), EdiDeadline.DueDate(new DateOnly(2026, 9, 1), new HashSet<DateOnly>()));
        // October 2026 → 15 November 2026 is a Sunday → Monday 16th.
        Assert.Equal(new DateOnly(2026, 11, 16), EdiDeadline.DueDate(new DateOnly(2026, 10, 20), new HashSet<DateOnly>()));
        // …and a holiday on Monday pushes it to Tuesday.
        Assert.Equal(new DateOnly(2026, 11, 17), EdiDeadline.DueDate(new DateOnly(2026, 10, 1), new HashSet<DateOnly> { new(2026, 11, 16) }));
    }

    [Fact]
    public async Task FirmOverview_ClassifiesEachClient_AndListsOnlyTheFirmsCompanies()
    {
        var (db, _) = await SeedAsync();
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Kontabiliteti SH.P.K." };
        db.Firms.Add(firm);
        Company Client(string name) => new() { Id = Guid.NewGuid(), Name = name, FirmId = firm.Id };
        var posted = Client("Posted Co");
        var draft = Client("Draft Co");
        var none = Client("No run Co");
        var empty = Client("No staff Co");
        var other = new Company { Id = Guid.NewGuid(), Name = "Other firm's client" };
        db.Companies.AddRange(posted, draft, none, empty, other);
        db.Employees.AddRange(NewEmployee(posted.Id, "A"), NewEmployee(draft.Id, "B"), NewEmployee(none.Id, "C"), NewEmployee(other.Id, "D"));
        var sep1 = new DateOnly(2026, 9, 1);
        var sep30 = new DateOnly(2026, 9, 30);
        db.PayrollRuns.AddRange(
            new PayrollRun { Id = Guid.NewGuid(), CompanyId = posted.Id, PeriodStart = sep1, PeriodEnd = sep30, State = PayrollRunState.Posted },
            new PayrollRun { Id = Guid.NewGuid(), CompanyId = draft.Id, PeriodStart = sep1, PeriodEnd = sep30, State = PayrollRunState.Draft });
        await db.SaveChangesAsync();

        var overview = (await new FirmPayrollService(db).OverviewAsync(firm.Id, sep1, new DateOnly(2026, 10, 12)))!;

        Assert.Equal(new[] { "Draft Co", "No run Co", "Posted Co" }, overview.Companies.Select(c => c.CompanyName));
        Assert.Equal("DueSoon", overview.Companies.Single(c => c.CompanyName == "Draft Co").Status);
        Assert.Null(overview.Companies.Single(c => c.CompanyName == "No run Co").RunState);
        Assert.Equal("Done", overview.Companies.Single(c => c.CompanyName == "Posted Co").Status);
        Assert.All(overview.Companies, c => Assert.Equal(3, c.DaysRemaining));

        var late = (await new FirmPayrollService(db).OverviewAsync(firm.Id, sep1, new DateOnly(2026, 10, 16)))!;
        Assert.Equal("Overdue", late.Companies.Single(c => c.CompanyName == "No run Co").Status);

        // The Monday digest goes to the firm's accountants while a client is still open.
        var accountant = await AddUserAsync(db, "acc@firm.test");
        db.Memberships.Add(Membership.ForFirm(accountant, firm.Id, MembershipRole.FirmAccountant));
        await db.SaveChangesAsync();
        var job = new FirmPayrollDigestJob(db, new NotificationOutbox(db), new FirmPayrollService(db));
        Assert.True(job.IsDue(new DateOnly(2026, 10, 12)));
        await job.RunAsync(new DateOnly(2026, 10, 12), CancellationToken.None);
        var digest = Assert.Single(await db.Notifications.AsNoTracking().Where(n => n.Template == NotificationTemplates.FirmPayrollDigest).ToListAsync());
        Assert.Equal("acc@firm.test", digest.RecipientEmail);
        Assert.Contains("Draft Co", P(digest)["summary"]);
        Assert.DoesNotContain("Other firm", P(digest)["summary"]);
    }
}
