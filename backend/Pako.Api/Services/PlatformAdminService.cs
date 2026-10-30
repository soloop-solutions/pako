using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Payroll;
using Pako.Domain.Platform;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Services;

// docs/PLATFORM_ADMIN.md: what the platform administrator manages — account requests, every user
// (enabled, company limit, administrator), each company's modules — and the usage overview.
public class PlatformAdminService
{
    private static readonly (AppModule Module, string Key)[] ModuleKeys =
    {
        (AppModule.Sales, "sales"), (AppModule.Purchases, "purchases"), (AppModule.Accounting, "accounting"),
        (AppModule.Reports, "reports"), (AppModule.Hr, "hr"), (AppModule.Payroll, "payroll")
    };

    private readonly PakoDbContext _db;
    private readonly UserManager<AppUser> _users;
    private readonly UserAdminService _userAdmin;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ILogger<PlatformAdminService> _logger;

    public PlatformAdminService(PakoDbContext db, UserManager<AppUser> users, UserAdminService userAdmin,
        IStringLocalizer<ErrorMessages> localizer, ILogger<PlatformAdminService> logger)
    {
        _db = db;
        _users = users;
        _userAdmin = userAdmin;
        _localizer = localizer;
        _logger = logger;
    }

    public static List<string> ModuleNames(AppModule modules) =>
        ModuleKeys.Where(m => modules.HasFlag(m.Module)).Select(m => m.Key).ToList();

    public static AppModule? ParseModules(IEnumerable<string> keys)
    {
        var result = AppModule.None;
        foreach (var key in keys)
        {
            var match = ModuleKeys.FirstOrDefault(m => string.Equals(m.Key, key, StringComparison.OrdinalIgnoreCase));
            if (match.Key is null) return null;
            result |= match.Module;
        }
        return result;
    }

    // ---- Account requests ----

    public async Task<string?> SubmitRequestAsync(AccountRequestRequest request)
    {
        var name = request.FullName?.Trim() ?? string.Empty;
        var email = request.Email?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 200 || !MailAddress.TryCreate(email, out _) || email.Length > 256)
        {
            return _localizer["AccountRequestInvalid"].Value;
        }
        if (request.RequestedCompanies is < 1 or > 100 || (request.Message?.Length ?? 0) > 2000
            || (request.Phone?.Length ?? 0) > 50 || (request.FirmName?.Length ?? 0) > 256
            || (request.BusinessNumber?.Length ?? 0) > 50 || (request.City?.Length ?? 0) > 100)
        {
            return _localizer["AccountRequestInvalid"].Value;
        }

        // Same answer either way: never reveal that an account or request already exists.
        var normalized = email.ToUpperInvariant();
        var known = await _db.Users.AnyAsync(u => u.NormalizedEmail == normalized)
            || await _db.AccountRequests.AnyAsync(r => r.Email.ToUpper() == normalized && r.Status == AccountRequestStatus.Pending);
        if (known) return null;

        _db.AccountRequests.Add(new AccountRequest
        {
            Id = Guid.NewGuid(),
            FullName = name,
            Email = email,
            Phone = Blank(request.Phone),
            FirmName = Blank(request.FirmName),
            BusinessNumber = Blank(request.BusinessNumber),
            City = Blank(request.City),
            RequestedCompanies = request.RequestedCompanies,
            Message = Blank(request.Message),
        });
        await _db.SaveChangesAsync();
        return null;
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    public async Task<List<AccountRequestResponse>> ListRequestsAsync(AccountRequestStatus? status)
    {
        var query = _db.AccountRequests.AsNoTracking();
        if (status is { } s) query = query.Where(r => r.Status == s);
        // Pending first (Status is stored as text, so its own order would be alphabetical), newest first.
        var requests = await query.OrderBy(r => r.Status == AccountRequestStatus.Pending ? 0 : 1).ThenByDescending(r => r.CreatedAt).ToListAsync();
        var deciderIds = requests.Where(r => r.DecidedByUserId != null).Select(r => r.DecidedByUserId!.Value).Distinct().ToList();
        var deciders = await _db.Users.AsNoTracking().Where(u => deciderIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Email);
        return requests.Select(r => ToResponse(r, r.DecidedByUserId is { } d ? deciders.GetValueOrDefault(d) : null)).ToList();
    }

    private static AccountRequestResponse ToResponse(AccountRequest r, string? decidedBy) => new(
        r.Id, r.FullName, r.Email, r.Phone, r.FirmName, r.BusinessNumber, r.City, r.RequestedCompanies, r.Message,
        r.Status.ToString(), r.CreatedAt, r.DecidedAt, r.DecisionNote, decidedBy);

    public async Task<(ApproveAccountRequestResponse? Result, string? Error)> ApproveAsync(Guid id, ApproveAccountRequestRequest request, Guid actor)
    {
        var accountRequest = await _db.AccountRequests.FirstOrDefaultAsync(r => r.Id == id);
        if (accountRequest is null) return (null, _localizer["AccountRequestNotFound"].Value);
        if (accountRequest.Status != AccountRequestStatus.Pending) return (null, _localizer["AccountRequestDecided"].Value);
        if (request.CompanyLimit is < 0) return (null, _localizer["CompanyLimitInvalid"].Value);
        if (await _users.FindByEmailAsync(accountRequest.Email) is not null) return (null, _localizer["AccountRequestEmailTaken"].Value);

        // No password yet: the person sets one from the emailed link (the same reset link the
        // "forgot password" flow uses).
        var user = new AppUser
        {
            UserName = accountRequest.Email,
            Email = accountRequest.Email,
            EmailConfirmed = true,
            FullName = accountRequest.FullName,
            CompanyLimit = request.CompanyLimit,
        };
        // The login and the decided request are saved together, so a failure leaves neither behind.
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        var created = await _users.CreateAsync(user);
        if (!created.Succeeded) return (null, string.Join(" ", created.Errors.Select(e => e.Description)));

        accountRequest.Status = AccountRequestStatus.Approved;
        accountRequest.DecidedAt = DateTime.UtcNow;
        accountRequest.DecidedByUserId = actor;
        accountRequest.DecisionNote = Blank(request.Note);
        accountRequest.UserId = user.Id;
        var url = await _userAdmin.QueuePasswordResetAsync(user, null);
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        _logger.LogInformation("Account request {RequestId} for {Email} approved by {Actor}", id, accountRequest.Email, actor);

        var decider = await _db.Users.AsNoTracking().Where(u => u.Id == actor).Select(u => u.Email).FirstOrDefaultAsync();
        return (new ApproveAccountRequestResponse(ToResponse(accountRequest, decider), user.Id, url), null);
    }

    public async Task<(AccountRequestResponse? Result, string? Error)> RejectAsync(Guid id, string? note, Guid actor)
    {
        var accountRequest = await _db.AccountRequests.FirstOrDefaultAsync(r => r.Id == id);
        if (accountRequest is null) return (null, _localizer["AccountRequestNotFound"].Value);
        if (accountRequest.Status != AccountRequestStatus.Pending) return (null, _localizer["AccountRequestDecided"].Value);
        accountRequest.Status = AccountRequestStatus.Rejected;
        accountRequest.DecidedAt = DateTime.UtcNow;
        accountRequest.DecidedByUserId = actor;
        accountRequest.DecisionNote = Blank(note);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Account request {RequestId} for {Email} rejected by {Actor}", id, accountRequest.Email, actor);
        var decider = await _db.Users.AsNoTracking().Where(u => u.Id == actor).Select(u => u.Email).FirstOrDefaultAsync();
        return (ToResponse(accountRequest, decider), null);
    }

    // ---- The signed-in account ----

    public async Task<MyAccountResponse?> MyAccountAsync(Guid userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) return null;
        var created = await _db.Companies.CountAsync(c => c.CreatedByUserId == userId);
        return new MyAccountResponse(user.Id, user.Email!, user.FullName, user.IsPlatformAdmin,
            user.IsPlatformAdmin ? null : user.CompanyLimit, created);
    }

    // ---- Users ----

    public async Task<List<PlatformUserResponse>> ListUsersAsync(string? search)
    {
        var query = _db.Users.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToUpperInvariant();
            query = query.Where(u => u.NormalizedEmail!.Contains(s) || (u.FullName != null && u.FullName.ToUpper().Contains(s)));
        }
        var users = await query.OrderBy(u => u.Email).ToListAsync();
        var created = await CompaniesCreatedByUserAsync();
        var access = await _db.Memberships.AsNoTracking().Where(m => m.IsActive)
            .GroupBy(m => m.UserId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        return users.Select(u => new PlatformUserResponse(u.Id, u.Email!, u.FullName, u.IsPlatformAdmin, u.IsDisabled,
            u.CompanyLimit, created.GetValueOrDefault(u.Id), access.GetValueOrDefault(u.Id), u.CreatedAt, u.LastLoginAt)).ToList();
    }

    private async Task<Dictionary<Guid, int>> CompaniesCreatedByUserAsync() =>
        await _db.Companies.AsNoTracking().Where(c => c.CreatedByUserId != null)
            .GroupBy(c => c.CreatedByUserId!.Value).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count);

    public async Task<string?> UpdateUserAsync(Guid userId, UpdatePlatformUserRequest request, Guid actor)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) return _localizer["PlatformUserNotFound"].Value;
        if (request.CompanyLimit is < 0) return _localizer["CompanyLimitInvalid"].Value;
        // An administrator can't lock themself out of the panel.
        if (userId == actor && (request.IsDisabled || !request.IsPlatformAdmin)) return _localizer["PlatformCannotChangeSelf"].Value;

        user.CompanyLimit = request.CompanyLimit;
        user.IsDisabled = request.IsDisabled;
        user.IsPlatformAdmin = request.IsPlatformAdmin;
        await _db.SaveChangesAsync();
        _logger.LogInformation("Platform user {UserId} updated by {Actor}: limit {Limit}, disabled {Disabled}, admin {Admin}",
            userId, actor, request.CompanyLimit, request.IsDisabled, request.IsPlatformAdmin);
        return null;
    }

    // ---- Companies & modules ----

    private record CompanyStats(int Users, int Invoices, int InvoicesLast30, int Bills, int Employees, int PayrollRuns, DateTime? LastActivity);

    // All companies, or only the given ones.
    private async Task<Dictionary<Guid, CompanyStats>> CompanyStatsAsync(IReadOnlyCollection<Guid>? only = null)
    {
        var since = DateTime.UtcNow.AddDays(-30);
        var users = await _db.Memberships.AsNoTracking().Where(m => m.IsActive && m.CompanyId != null && (only == null || only.Contains(m.CompanyId.Value)))
            .GroupBy(m => m.CompanyId!.Value).Select(g => new { g.Key, Count = g.Select(m => m.UserId).Distinct().Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count);
        var invoices = await _db.Invoices.AsNoTracking().Where(i => i.State == InvoiceState.Posted && (only == null || only.Contains(i.CompanyId)))
            .GroupBy(i => i.CompanyId)
            .Select(g => new { g.Key, Count = g.Count(), Recent = g.Count(i => i.CreatedAt >= since), Last = g.Max(i => i.CreatedAt) })
            .ToDictionaryAsync(g => g.Key);
        var bills = await _db.Bills.AsNoTracking().Where(b => b.State == BillState.Posted && (only == null || only.Contains(b.CompanyId)))
            .GroupBy(b => b.CompanyId).Select(g => new { g.Key, Count = g.Count(), Last = g.Max(b => b.CreatedAt) })
            .ToDictionaryAsync(g => g.Key);
        var employees = await _db.Employees.AsNoTracking().Where(e => e.IsActive && (only == null || only.Contains(e.CompanyId)))
            .GroupBy(e => e.CompanyId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        var runs = await _db.PayrollRuns.AsNoTracking().Where(r => (r.State == PayrollRunState.Posted || r.State == PayrollRunState.Paid) && (only == null || only.Contains(r.CompanyId)))
            .GroupBy(r => r.CompanyId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);

        var ids = users.Keys.Concat(invoices.Keys).Concat(bills.Keys).Concat(employees.Keys).Concat(runs.Keys).Distinct();
        return ids.ToDictionary(id => id, id =>
        {
            var inv = invoices.GetValueOrDefault(id);
            var bill = bills.GetValueOrDefault(id);
            DateTime? last = new[] { inv?.Last, bill?.Last }.Where(d => d != null).Max();
            return new CompanyStats(users.GetValueOrDefault(id), inv?.Count ?? 0, inv?.Recent ?? 0, bill?.Count ?? 0,
                employees.GetValueOrDefault(id), runs.GetValueOrDefault(id), last);
        });
    }

    public async Task<List<PlatformCompanyResponse>> ListCompaniesAsync(string? search, Guid? createdBy, Guid? onlyId = null)
    {
        var query = _db.Companies.AsNoTracking();
        if (onlyId is { } id) query = query.Where(c => c.Id == id);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToUpper();
            query = query.Where(c => c.Name.ToUpper().Contains(s) || (c.BusinessNumber != null && c.BusinessNumber.Contains(s)));
        }
        if (createdBy is { } owner) query = query.Where(c => c.CreatedByUserId == owner);
        var companies = await query.OrderBy(c => c.Name).ToListAsync();
        var ownerIds = companies.Where(c => c.CreatedByUserId != null).Select(c => c.CreatedByUserId!.Value).Distinct().ToList();
        var owners = await _db.Users.AsNoTracking().Where(u => ownerIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Email);
        var stats = await CompanyStatsAsync(onlyId is null && createdBy is null ? null : companies.Select(c => c.Id).ToList());
        return companies.Select(c =>
        {
            var st = stats.GetValueOrDefault(c.Id) ?? new CompanyStats(0, 0, 0, 0, 0, 0, null);
            return new PlatformCompanyResponse(c.Id, c.Name, c.BusinessNumber, c.CreatedByUserId,
                c.CreatedByUserId is { } o ? owners.GetValueOrDefault(o) : null, ModuleNames(c.EnabledModules), c.IsArchived,
                c.CreatedAt, st.Users, st.Invoices, st.Bills, st.Employees, st.LastActivity);
        }).ToList();
    }

    public async Task<(PlatformCompanyResponse? Result, string? Error)> UpdateModulesAsync(Guid companyId, List<string> modules, Guid actor)
    {
        var parsed = ParseModules(modules ?? new List<string>());
        if (parsed is not { } enabled) return (null, _localizer["ModulesInvalid"].Value);
        // Payroll pays employees, who live in HR.
        if (enabled.HasFlag(AppModule.Payroll) && !enabled.HasFlag(AppModule.Hr)) return (null, _localizer["PayrollNeedsHr"].Value);
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return (null, string.Format(_localizer["CompanyNotFound"].Value, companyId));
        company.EnabledModules = enabled;
        await _db.SaveChangesAsync();
        _logger.LogInformation("Modules of company {CompanyId} set to {Modules} by {Actor}", companyId, enabled, actor);
        return ((await ListCompaniesAsync(null, null, companyId)).Single(), null);
    }

    // ---- Usage overview ----

    public async Task<PlatformOverviewResponse> OverviewAsync()
    {
        var since = DateTime.UtcNow.AddDays(-30);
        var users = await _db.Users.AsNoTracking().ToListAsync();
        var companies = await _db.Companies.AsNoTracking().Select(c => new { c.Id, c.CreatedByUserId }).ToListAsync();
        var stats = await CompanyStatsAsync();
        var pending = await _db.AccountRequests.CountAsync(r => r.Status == AccountRequestStatus.Pending);

        // An accountant is anyone allowed to create companies, or who has created some.
        var created = companies.Where(c => c.CreatedByUserId != null).GroupBy(c => c.CreatedByUserId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(c => c.Id).ToList());
        var accountants = users
            .Where(u => created.ContainsKey(u.Id) || (!u.IsPlatformAdmin && u.CompanyLimit is null or > 0))
            .Select(u =>
            {
                var own = created.GetValueOrDefault(u.Id) ?? new List<Guid>();
                var s = own.Select(id => stats.GetValueOrDefault(id)).Where(x => x != null).Select(x => x!).ToList();
                return new AccountantUsageResponse(u.Id, u.Email!, u.FullName, u.IsDisabled, u.IsPlatformAdmin, u.IsPlatformAdmin ? null : u.CompanyLimit,
                    own.Count, s.Sum(x => Math.Max(0, x.Users - 1)), s.Sum(x => x.Invoices), s.Sum(x => x.InvoicesLast30),
                    s.Sum(x => x.Bills), s.Sum(x => x.Employees), s.Sum(x => x.PayrollRuns), u.LastLoginAt,
                    s.Select(x => x.LastActivity).Where(d => d != null).DefaultIfEmpty(null).Max());
            })
            .OrderByDescending(a => a.PostedInvoices).ThenBy(a => a.Email)
            .ToList();

        return new PlatformOverviewResponse(
            users.Count, accountants.Count, users.Count(u => u.IsPlatformAdmin), users.Count(u => u.IsDisabled),
            companies.Count, pending, stats.Values.Sum(s => s.InvoicesLast30),
            users.Count(u => u.LastLoginAt >= since), accountants);
    }
}
