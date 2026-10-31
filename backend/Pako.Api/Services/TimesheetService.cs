using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// G12: hours worked, by day and kind; approving a month turns premium hours into hour-based
// payroll adjustments (priced exactly like a hand-typed one).
public class TimesheetService
{
    public const int MaxImportLines = 10_000;

    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public TimesheetService(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    public async Task<IReadOnlySet<DateOnly>> HolidaysAsync(Guid companyId, DateOnly from, DateOnly to) =>
        (await _db.PublicHolidays.AsNoTracking()
            .Where(h => h.CompanyId == companyId && h.Date >= from && h.Date <= to)
            .Select(h => h.Date)
            .ToListAsync()).ToHashSet();

    public string? Validate(decimal hours) =>
        hours is <= 0m or > 24m || hours != Math.Round(hours, 2) ? _localizer["TimeEntryHoursInvalid"].Value : null;

    // Approves the month's entries (all employees, or one) and rebuilds its timesheet adjustments.
    public async Task<List<TimesheetSummaryRow>> ApproveMonthAsync(Guid companyId, DateOnly anyDayInMonth, Guid? employeeId, Guid userId)
    {
        var month = new DateOnly(anyDayInMonth.Year, anyDayInMonth.Month, 1);
        var monthEnd = month.AddMonths(1).AddDays(-1);

        var entries = await _db.TimeEntries
            .Where(t => t.CompanyId == companyId && t.Date >= month && t.Date <= monthEnd && (employeeId == null || t.EmployeeId == employeeId))
            .ToListAsync();
        var employeeIds = entries.Select(t => t.EmployeeId).Distinct().ToList();
        var employees = await _db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id);
        var previous = await _db.PayrollAdjustments
            .Where(a => a.CompanyId == companyId && a.FromTimesheet && a.Period == month && employeeIds.Contains(a.EmployeeId))
            .ToListAsync();

        var now = DateTime.UtcNow;
        foreach (var group in entries.GroupBy(t => t.EmployeeId))
        {
            var mine = previous.Where(a => a.EmployeeId == group.Key).ToList();
            if (mine.Any(a => a.PayrollRunId != null)) continue; // a run already used them

            foreach (var entry in group.Where(t => !t.IsApproved))
            {
                entry.ApprovedAt = now;
                entry.ApprovedByUserId = userId;
            }

            _db.PayrollAdjustments.RemoveRange(mine);
            foreach (var byKind in group.GroupBy(t => t.Kind))
            {
                if (TimeEntry.AdjustmentKindFor(byKind.Key) is not { } kind) continue;
                var hours = byKind.Sum(t => t.Hours);
                var (amount, multiplier) = await PayrollAdjustmentsController.HourBasedAmountAsync(
                    _db, companyId, employees[group.Key], month, kind, hours, null);
                _db.PayrollAdjustments.Add(new PayrollAdjustment
                {
                    Id = Guid.NewGuid(),
                    CompanyId = companyId,
                    EmployeeId = group.Key,
                    Period = month,
                    Kind = kind,
                    Description = _localizer["TimesheetAdjustmentDescription"].Value,
                    Hours = hours,
                    RateMultiplier = multiplier,
                    Amount = amount,
                    FromTimesheet = true
                });
            }
        }

        await _db.SaveChangesAsync();
        return await SummaryAsync(companyId, month, employeeId);
    }

    public async Task<List<TimesheetSummaryRow>> SummaryAsync(Guid companyId, DateOnly anyDayInMonth, Guid? employeeId = null)
    {
        var month = new DateOnly(anyDayInMonth.Year, anyDayInMonth.Month, 1);
        var monthEnd = month.AddMonths(1).AddDays(-1);
        var entries = await _db.TimeEntries.AsNoTracking()
            .Where(t => t.CompanyId == companyId && t.Date >= month && t.Date <= monthEnd && (employeeId == null || t.EmployeeId == employeeId))
            .ToListAsync();
        var employeeIds = entries.Select(t => t.EmployeeId).Distinct().ToList();
        var names = await _db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.Name);
        var locked = (await _db.PayrollAdjustments.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.FromTimesheet && a.Period == month && a.PayrollRunId != null)
                .Select(a => a.EmployeeId)
                .ToListAsync())
            .ToHashSet();

        decimal Sum(IEnumerable<TimeEntry> list, TimeEntryKind kind) => list.Where(t => t.Kind == kind).Sum(t => t.Hours);
        return entries.GroupBy(t => t.EmployeeId)
            .Select(g => new TimesheetSummaryRow(g.Key, names.GetValueOrDefault(g.Key, string.Empty),
                Sum(g, TimeEntryKind.Regular), Sum(g, TimeEntryKind.Overtime), Sum(g, TimeEntryKind.Night),
                Sum(g, TimeEntryKind.Weekend), Sum(g, TimeEntryKind.Holiday), g.Count(t => !t.IsApproved), locked.Contains(g.Key)))
            .OrderBy(r => r.EmployeeName)
            .ToList();
    }

    // CSV from a clock system: personal number (or email), date, hours, [kind], [note]. Comma,
    // semicolon or tab separated; a header line is skipped; dates as yyyy-MM-dd or dd.MM.yyyy.
    // Bad lines are reported and skipped — the good ones are kept.
    public async Task<TimesheetImportResponse> ImportAsync(Guid companyId, Stream csv)
    {
        using var reader = new StreamReader(csv);
        var text = await reader.ReadToEndAsync();
        var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).ToList();
        var errors = new List<TimesheetImportError>();
        if (lines.Count > MaxImportLines) return new TimesheetImportResponse(0, new List<TimesheetImportError> { new(0, _localizer["TimesheetImportTooLarge"].Value) });

        var employees = await _db.Employees.AsNoTracking().Where(e => e.CompanyId == companyId && e.IsActive)
            .Select(e => new { e.Id, e.PersonalNumber, e.Email }).ToListAsync();
        var byNumber = employees.Where(e => e.PersonalNumber != null).GroupBy(e => e.PersonalNumber!).ToDictionary(g => g.Key, g => g.First().Id);
        var byEmail = employees.Where(e => e.Email != null).GroupBy(e => e.Email!.ToLowerInvariant()).ToDictionary(g => g.Key, g => g.First().Id);

        var parsed = new List<TimeEntry>();
        var deriveKind = new HashSet<Guid>(); // entries whose kind comes from the calendar
        for (var i = 0; i < lines.Count; i++)
        {
            var raw = lines[i];
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var separator = raw.Contains('\t') ? '\t' : raw.Contains(';') ? ';' : ',';
            var cells = raw.Split(separator).Select(c => c.Trim().Trim('"')).ToArray();
            var lineNo = i + 1;
            if (cells.Length < 3) { errors.Add(new(lineNo, _localizer["TimesheetImportColumns"].Value)); continue; }

            var hasDate = TryParseDate(cells[1], out var date);
            if (i == 0 && !hasDate) continue; // header

            var key = cells[0];
            Guid? employeeId = byNumber.TryGetValue(key, out var a) ? a : byEmail.TryGetValue(key.ToLowerInvariant(), out var b) ? b : null;
            if (employeeId is null) { errors.Add(new(lineNo, string.Format(_localizer["TimesheetImportUnknownEmployee"].Value, key))); continue; }
            if (!hasDate) { errors.Add(new(lineNo, _localizer["TimesheetImportDate"].Value)); continue; }
            if (!decimal.TryParse(cells[2].Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out var hours) || Validate(hours) is not null)
            {
                errors.Add(new(lineNo, _localizer["TimeEntryHoursInvalid"].Value));
                continue;
            }

            TimeEntryKind? kind = null;
            if (cells.Length > 3 && !string.IsNullOrWhiteSpace(cells[3]))
            {
                if (!Enum.TryParse<TimeEntryKind>(cells[3], true, out var k)) { errors.Add(new(lineNo, _localizer["TimesheetImportKind"].Value)); continue; }
                kind = k;
            }

            parsed.Add(new TimeEntry
            {
                Id = Guid.NewGuid(), CompanyId = companyId, EmployeeId = employeeId.Value, Date = date, Hours = hours,
                Kind = kind ?? TimeEntryKind.Regular, Source = TimeEntrySource.Import,
                Note = cells.Length > 4 && !string.IsNullOrWhiteSpace(cells[4]) ? cells[4][..Math.Min(cells[4].Length, 256)] : null
            });
            if (kind is null) deriveKind.Add(parsed[^1].Id);
        }

        if (parsed.Count > 0)
        {
            var holidays = await HolidaysAsync(companyId, parsed.Min(t => t.Date), parsed.Max(t => t.Date));
            foreach (var entry in parsed.Where(t => deriveKind.Contains(t.Id))) entry.Kind = TimeEntry.KindFor(entry.Date, holidays);
            _db.TimeEntries.AddRange(parsed);
            await _db.SaveChangesAsync();
        }

        return new TimesheetImportResponse(parsed.Count, errors);
    }

    private static bool TryParseDate(string value, out DateOnly date) =>
        DateOnly.TryParseExact(value, new[] { "yyyy-MM-dd", "dd.MM.yyyy", "d.M.yyyy", "dd/MM/yyyy" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
}
