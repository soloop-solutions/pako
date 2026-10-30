using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// I14: one payroll month across every client company of a firm, with each company's EDI deadline.
public class FirmPayrollService
{
    public const int DueSoonDays = 5;

    private readonly PakoDbContext _db;

    public FirmPayrollService(PakoDbContext db)
    {
        _db = db;
    }

    public async Task<FirmPayrollOverviewResponse?> OverviewAsync(Guid firmId, DateOnly anyDayInMonth, DateOnly today)
    {
        var firm = await _db.Firms.AsNoTracking().FirstOrDefaultAsync(f => f.Id == firmId);
        if (firm is null) return null;

        var monthStart = new DateOnly(anyDayInMonth.Year, anyDayInMonth.Month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);
        var nextMonthStart = monthStart.AddMonths(1);
        var nextMonthEnd = nextMonthStart.AddMonths(1).AddDays(-1);

        var companies = await _db.Companies.AsNoTracking()
            .Where(c => c.FirmId == firmId && !c.IsArchived)
            .OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name })
            .ToListAsync();
        var companyIds = companies.Select(c => c.Id).ToList();

        var employees = (await _db.Employees.AsNoTracking()
                .Where(e => companyIds.Contains(e.CompanyId) && e.IsActive)
                .ToListAsync())
            .Where(e => e.IsEmployedDuring(monthStart, monthEnd))
            .GroupBy(e => e.CompanyId)
            .ToDictionary(g => g.Key, g => g.Count());
        var runs = await _db.PayrollRuns.AsNoTracking()
            .Include(r => r.Lines)
            .Where(r => companyIds.Contains(r.CompanyId) && r.PeriodStart <= monthEnd && r.PeriodEnd >= monthStart)
            .ToListAsync();
        var holidays = (await _db.PublicHolidays.AsNoTracking()
                .Where(h => companyIds.Contains(h.CompanyId) && h.Date >= nextMonthStart && h.Date <= nextMonthEnd)
                .Select(h => new { h.CompanyId, h.Date })
                .ToListAsync())
            .GroupBy(h => h.CompanyId)
            .ToDictionary(g => g.Key, g => (IReadOnlySet<DateOnly>)g.Select(h => h.Date).ToHashSet());

        var rows = companies.Select(c =>
        {
            var run = runs.Where(r => r.CompanyId == c.Id).OrderByDescending(r => r.PeriodStart).FirstOrDefault();
            var due = EdiDeadline.DueDate(monthStart, holidays.GetValueOrDefault(c.Id) ?? new HashSet<DateOnly>());
            var daysRemaining = due.DayNumber - today.DayNumber;
            var done = run?.State is PayrollRunState.Posted or PayrollRunState.Paid;
            var status = done ? "Done" : daysRemaining < 0 ? "Overdue" : daysRemaining <= DueSoonDays ? "DueSoon" : "Open";
            return new FirmPayrollCompanyResponse(c.Id, c.Name, run?.Id, run?.State.ToString(), employees.GetValueOrDefault(c.Id),
                run?.Lines.Sum(l => l.GrossSalary), due, daysRemaining, status);
        })
        // Companies with no staff and no run have nothing to declare.
        .Where(r => r.EmployeeCount > 0 || r.RunId != null)
        .ToList();

        return new FirmPayrollOverviewResponse(firm.Id, firm.Name, monthStart, rows);
    }
}
