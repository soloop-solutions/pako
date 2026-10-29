using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Draft → Approved → Posted → Paid. A run is composed from HR data (PayrollRunComposer) when it
// is created and whenever a Draft is recomputed; it consumes the period's unconsumed adjustments,
// which are released again if the Draft is recomputed or deleted.
[ApiController]
[Route("api/companies/{companyId:guid}/payroll-runs")]
[Authorize]
public class PayrollRunsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PayrollRunComposer _composer;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PayrollRunsController(PakoDbContext db, PayrollRunComposer composer, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _composer = composer;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // Unpaged: one run per month, so even ten years of history is ~120 rows.
    [HttpGet(Name = "ListPayrollRuns")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<PayrollRunDetailResponse>>> List(Guid companyId)
    {
        var runs = await _db.PayrollRuns.AsNoTracking()
            .Include(r => r.Lines)
            .Where(r => r.CompanyId == companyId)
            .OrderByDescending(r => r.PeriodStart)
            .ToListAsync();

        var names = await LookupsAsync(companyId);
        return Ok(runs.Select(r => ToResponse(r, names, new List<PayrollAdjustment>(), new List<string>(), includeLines: false)).ToList());
    }

    [HttpGet("{id:guid}", Name = "GetPayrollRun")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<PayrollRunDetailResponse>> Get(Guid companyId, Guid id)
    {
        var run = await _db.PayrollRuns.AsNoTracking()
            .Include(r => r.Lines)
            .FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (run is null) return NotFound();

        return Ok(await ToDetailAsync(companyId, run, new List<string>()));
    }

    [HttpPost(Name = "CreatePayrollRun")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(typeof(PayrollRunDetailResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PayrollRunDetailResponse>> Create(Guid companyId, CreatePayrollRunRequest request)
    {
        if (request.PeriodEnd < request.PeriodStart) return BadRequest(_localizer["PeriodEndBeforeStart"].Value);

        if (await _db.PayrollRuns.AnyAsync(r => r.CompanyId == companyId &&
                r.PeriodStart <= request.PeriodEnd && r.PeriodEnd >= request.PeriodStart))
        {
            return BadRequest(_localizer["PayrollPeriodOverlaps"].Value);
        }

        var composed = await _composer.ComposeAsync(companyId, request.PeriodStart, request.PeriodEnd);
        if (composed.Lines.Count == 0) return BadRequest(_localizer["NoActiveEmployees"].Value);

        var run = new PayrollRun
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            PeriodStart = request.PeriodStart,
            PeriodEnd = request.PeriodEnd,
            Lines = composed.Lines
        };
        foreach (var adjustment in composed.ConsumedAdjustments)
        {
            adjustment.PayrollRunId = run.Id;
        }

        _db.PayrollRuns.Add(run);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, await ToDetailAsync(companyId, run, composed.Warnings));
    }

    // Re-reads HR data (salaries, adjustments, leave) into a Draft run.
    [HttpPost("{id:guid}/recompute", Name = "RecomputePayrollRun")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<PayrollRunDetailResponse>> Recompute(Guid companyId, Guid id)
    {
        var run = await _db.PayrollRuns.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (run is null) return NotFound();
        if (run.State != PayrollRunState.Draft) return BadRequest(_localizer["PayrollRunNotDraft"].Value);

        await ReleaseAdjustmentsAsync(run.Id);
        _db.PayslipLines.RemoveRange(run.Lines);
        await _db.SaveChangesAsync();

        var composed = await _composer.ComposeAsync(companyId, run.PeriodStart, run.PeriodEnd);
        foreach (var line in composed.Lines)
        {
            line.PayrollRunId = run.Id;
        }

        _db.PayslipLines.AddRange(composed.Lines);
        foreach (var adjustment in composed.ConsumedAdjustments)
        {
            adjustment.PayrollRunId = run.Id;
        }

        await _db.SaveChangesAsync();

        run.Lines = composed.Lines;
        return Ok(await ToDetailAsync(companyId, run, composed.Warnings));
    }

    [HttpDelete("{id:guid}", Name = "DeletePayrollRun")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        var run = await _db.PayrollRuns.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (run is null) return NotFound();
        if (run.State != PayrollRunState.Draft) return BadRequest(_localizer["PayrollRunNotDraft"].Value);

        await ReleaseAdjustmentsAsync(run.Id);
        _db.PayrollRuns.Remove(run);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:guid}/approve", Name = "ApprovePayrollRun")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<PayrollRunDetailResponse>> Approve(Guid companyId, Guid id)
    {
        var run = await _db.PayrollRuns.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (run is null) return NotFound();

        try
        {
            run.Approve(CurrentUserId);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }

        await _db.SaveChangesAsync();
        return Ok(await ToDetailAsync(companyId, run, new List<string>()));
    }

    [HttpPost("{id:guid}/return-to-draft", Name = "ReturnPayrollRunToDraft")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<PayrollRunDetailResponse>> ReturnToDraft(Guid companyId, Guid id)
    {
        var run = await _db.PayrollRuns.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (run is null) return NotFound();

        try
        {
            run.ReturnToDraft();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }

        await _db.SaveChangesAsync();
        return Ok(await ToDetailAsync(companyId, run, new List<string>()));
    }

    // Posting books to the ledger, so it needs Accounting write as well as HR for staff — a
    // partner-scoped staff user never has Accounting, so can prepare payroll but never post it.
    [HttpPost("{id:guid}/post", Name = "PostPayrollRun")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    public async Task<ActionResult<PayrollRunDetailResponse>> Post(Guid companyId, Guid id)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        var payrollRun = await _db.PayrollRuns.Include(r => r.Lines)
            .FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (payrollRun is null) return NotFound();

        // B9: payroll isn't Sale/Purchase/Cash/Bank in nature — stays on General, the same journal
        // it always posted to, just resolved explicitly now that "the first journal for this
        // company" is ambiguous with five seeded.
        var journal = await JournalResolver.GetAsync(_db, companyId, JournalType.General);
        if (journal is null) return BadRequest(_localizer["NoJournalToPost"].Value);

        var defaults = await _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);
        if (defaults is null ||
            defaults.SalaryExpenseAccountId is null ||
            defaults.PitPayableAccountId is null ||
            defaults.PensionPayableAccountId is null ||
            defaults.NetPayPayableAccountId is null)
        {
            return BadRequest(_localizer["NoPayrollAccounts"].Value);
        }

        // B4: the caller's own effective lock dates — company's own value unless CurrentUserId
        // holds a live exception for that field (AccountLockResolver never touches HardLockDate).
        var effectiveCompany = await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId);

        JournalEntry journalEntry;
        try
        {
            journalEntry = payrollRun.Post(effectiveCompany, journal.Id, new PayrollPostingAccounts(
                defaults.SalaryExpenseAccountId.Value,
                defaults.PitPayableAccountId.Value,
                defaults.PensionPayableAccountId.Value,
                defaults.NetPayPayableAccountId.Value,
                defaults.BonusExpenseAccountId,
                defaults.EmployerPensionExpenseAccountId,
                defaults.EmployerPensionPayableAccountId,
                defaults.PayrollDeductionsAccountId));
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException or
            HardLockDateViolationException or
            InconsistentForeignCurrencyDataException)
        {
            return BadRequest(ex.Message);
        }

        journalEntry.PostedByUserId = CurrentUserId;
        journalEntry.SourceDocumentId = payrollRun.Id;
        journalEntry.SequenceNumber = JournalSequencer.ReserveNext(journal);

        _db.JournalEntries.Add(journalEntry);
        await _db.SaveChangesAsync();

        return Ok(await ToDetailAsync(companyId, payrollRun, new List<string>()));
    }

    // Net pay leaves the bank in one transfer (bank batch). Dr 220100 / Cr the bank or cash account.
    [HttpPost("{id:guid}/pay", Name = "PayPayrollRun")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    public async Task<ActionResult<PayrollRunDetailResponse>> Pay(Guid companyId, Guid id, PayPayrollRunRequest request)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        var payrollRun = await _db.PayrollRuns.Include(r => r.Lines)
            .FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (payrollRun is null) return NotFound();
        if (payrollRun.State != PayrollRunState.Posted) return BadRequest(_localizer["PayrollRunNotPosted"].Value);

        var cashOrBankAccount = await _db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.CashOrBankAccountId && a.CompanyId == companyId);
        if (cashOrBankAccount is null || (cashOrBankAccount.AccountSubType != AccountSubType.Cash && cashOrBankAccount.AccountSubType != AccountSubType.Bank))
        {
            return BadRequest(_localizer["InvalidCashOrBankAccount"].Value);
        }

        var defaults = await _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);
        if (defaults?.NetPayPayableAccountId is null) return BadRequest(_localizer["NoPayrollAccounts"].Value);

        var journal = await JournalResolver.GetAsync(_db, companyId, JournalResolver.SettlementJournalType(cashOrBankAccount.AccountSubType));
        if (journal is null) return BadRequest(_localizer["NoJournalToPost"].Value);

        var effectiveCompany = await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId);

        JournalEntry journalEntry;
        try
        {
            journalEntry = payrollRun.Pay(effectiveCompany, journal.Id, request.PaidOn, defaults.NetPayPayableAccountId.Value, cashOrBankAccount.Id);
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException or
            HardLockDateViolationException)
        {
            return BadRequest(ex.Message);
        }

        journalEntry.PostedByUserId = CurrentUserId;
        journalEntry.SourceDocumentId = payrollRun.Id;
        journalEntry.SequenceNumber = JournalSequencer.ReserveNext(journal);

        _db.JournalEntries.Add(journalEntry);
        await _db.SaveChangesAsync();

        return Ok(await ToDetailAsync(companyId, payrollRun, new List<string>()));
    }

    // Payroll register: one row per payslip, every component.
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("{id:guid}/register/export", Name = "PayrollRegisterExport")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<IActionResult> RegisterExport(Guid companyId, Guid id)
    {
        var run = await _db.PayrollRuns.AsNoTracking().Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (run is null) return NotFound();

        var detail = await ToDetailAsync(companyId, run, new List<string>());
        var headers = new[]
        {
            "Employee", "Personal number", "Department", "Working days", "Paid days", "Base salary", "Bonuses",
            "Other additions", "Gross", "Employee pension", "Employer pension", "PIT", "Deductions", "Net pay", "Primary employer"
        };
        var rows = detail.Lines.Select(l => (IReadOnlyList<object?>)new object?[]
        {
            l.EmployeeName, l.PersonalNumber, l.DepartmentName, l.WorkingDays, l.PaidDays, l.BaseSalary, l.BonusAmount,
            l.OtherAdditionsAmount, l.GrossSalary, l.EmployeePensionAmount, l.EmployerPensionAmount, l.PitAmount,
            l.DeductionsAmount, l.NetPay, l.IsPrimaryEmployer ? "Yes" : "No"
        }).ToList();

        var bytes = ExcelExportService.BuildWorkbook("Payroll register", headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"payroll-register-{run.PeriodStart:yyyyMM}.xlsx");
    }

    // The per-employee figures ATK's monthly EDI wage & pension declaration asks for, in that
    // order. ATK publishes no import layout this repo has seen — confirm the column order against
    // the live EDI form before relying on it for upload (same caveat as ExcelExportService).
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("{id:guid}/edi/export", Name = "PayrollEdiExport")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<IActionResult> EdiExport(Guid companyId, Guid id)
    {
        var run = await _db.PayrollRuns.AsNoTracking().Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (run is null) return NotFound();

        var detail = await ToDetailAsync(companyId, run, new List<string>());
        var headers = new[]
        {
            "Numri personal", "Emri dhe mbiemri", "Paga bruto", "Kontributi i punëtorit (5%)",
            "Kontributi i punëdhënësit (5%)", "Paga e tatueshme", "Tatimi i mbajtur", "Punëdhënës primar"
        };
        var rows = detail.Lines.Select(l => (IReadOnlyList<object?>)new object?[]
        {
            l.PersonalNumber, l.EmployeeName, l.GrossSalary, l.EmployeePensionAmount, l.EmployerPensionAmount,
            l.GrossSalary - l.EmployeePensionAmount, l.PitAmount, l.IsPrimaryEmployer ? "Po" : "Jo"
        }).ToList();

        var bytes = ExcelExportService.BuildWorkbook("EDI", headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"edi-paga-{run.PeriodStart:yyyyMM}.xlsx");
    }

    // The yearly income and withholding statement each employee needs for their own annual
    // return (due 31 March). Posted and Paid runs only — a Draft isn't income yet.
    [HttpGet("annual-statement/{employeeId:guid}", Name = "GetAnnualEmployeeStatement")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<AnnualEmployeeStatementResponse>> AnnualStatement(Guid companyId, Guid employeeId, [FromQuery] int year)
    {
        var employee = await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == employeeId && e.CompanyId == companyId);
        if (employee is null) return NotFound();

        var yearStart = new DateOnly(year, 1, 1);
        var yearEnd = new DateOnly(year, 12, 31);
        var months = await (
            from l in _db.PayslipLines.AsNoTracking()
            join r in _db.PayrollRuns.AsNoTracking() on l.PayrollRunId equals r.Id
            where r.CompanyId == companyId && l.EmployeeId == employeeId &&
                (r.State == PayrollRunState.Posted || r.State == PayrollRunState.Paid) &&
                r.PeriodEnd >= yearStart && r.PeriodEnd <= yearEnd
            orderby r.PeriodStart
            select new AnnualEmployeeStatementMonth(r.PeriodStart, r.PeriodEnd, l.GrossSalary, l.EmployeePensionAmount,
                l.EmployerPensionAmount, l.PitAmount, l.NetPay)).ToListAsync();

        return Ok(new AnnualEmployeeStatementResponse(
            employee.Id, employee.Name, employee.PersonalNumber, year, months,
            months.Sum(m => m.GrossSalary), months.Sum(m => m.EmployeePension), months.Sum(m => m.EmployerPension),
            months.Sum(m => m.Pit), months.Sum(m => m.NetPay)));
    }

    private async Task ReleaseAdjustmentsAsync(Guid runId)
    {
        var adjustments = await _db.PayrollAdjustments.Where(a => a.PayrollRunId == runId).ToListAsync();
        foreach (var adjustment in adjustments)
        {
            adjustment.PayrollRunId = null;
        }
    }

    private record Lookups(
        Dictionary<Guid, (string Name, string? PersonalNumber)> Employees,
        Dictionary<Guid, string> Departments);

    private async Task<Lookups> LookupsAsync(Guid companyId)
    {
        var employees = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId)
            .Select(e => new { e.Id, e.Name, e.PersonalNumber })
            .ToDictionaryAsync(e => e.Id, e => (e.Name, e.PersonalNumber));
        var departments = await _db.Departments.AsNoTracking()
            .Where(d => d.CompanyId == companyId)
            .ToDictionaryAsync(d => d.Id, d => d.Name);
        return new Lookups(employees, departments);
    }

    private async Task<PayrollRunDetailResponse> ToDetailAsync(Guid companyId, PayrollRun run, List<string> warnings)
    {
        var lookups = await LookupsAsync(companyId);
        var adjustments = await _db.PayrollAdjustments.AsNoTracking().Where(a => a.PayrollRunId == run.Id).ToListAsync();

        foreach (var line in run.Lines.Where(l => l.NetPay < 0m))
        {
            warnings.Add($"NegativeNetPay:{lookups.Employees.GetValueOrDefault(line.EmployeeId).Name}");
        }

        return ToResponse(run, lookups, adjustments, warnings, includeLines: true);
    }

    private static PayrollRunDetailResponse ToResponse(
        PayrollRun r, Lookups lookups, List<PayrollAdjustment> adjustments, List<string> warnings, bool includeLines)
    {
        var totals = new PayrollRunTotals(
            r.Lines.Sum(l => l.GrossSalary),
            r.Lines.Sum(l => l.PitAmount),
            r.Lines.Sum(l => l.EmployeePensionAmount),
            r.Lines.Sum(l => l.EmployerPensionAmount),
            r.Lines.Sum(l => l.DeductionsAmount),
            r.Lines.Sum(l => l.NetPay),
            r.Lines.Sum(l => l.GrossSalary + l.EmployerPensionAmount));

        var lines = !includeLines
            ? new List<PayslipDetailResponse>()
            : r.Lines
                .Select(l =>
                {
                    var employee = lookups.Employees.GetValueOrDefault(l.EmployeeId);
                    return new PayslipDetailResponse(
                        l.Id, l.EmployeeId, employee.Name ?? string.Empty, employee.PersonalNumber,
                        l.DepartmentId, l.DepartmentId is { } d ? lookups.Departments.GetValueOrDefault(d) : null,
                        l.BaseSalary, l.WorkingDays, l.PaidDays, l.BonusAmount, l.OtherAdditionsAmount, l.GrossSalary,
                        l.PitAmount, l.EmployeePensionAmount, l.EmployerPensionAmount, l.DeductionsAmount, l.NetPay,
                        l.IsPrimaryEmployer,
                        adjustments.Where(a => a.EmployeeId == l.EmployeeId)
                            .Select(a => PayrollAdjustmentsController.ToResponse(a, employee.Name ?? string.Empty))
                            .ToList());
                })
                .OrderBy(l => l.EmployeeName)
                .ToList();

        return new PayrollRunDetailResponse(
            r.Id, r.PeriodStart, r.PeriodEnd, r.State.ToString(), r.JournalEntryId, r.PaymentJournalEntryId, r.PaidOn,
            r.ApprovedAt, r.Notes, totals, lines, warnings);
    }
}
