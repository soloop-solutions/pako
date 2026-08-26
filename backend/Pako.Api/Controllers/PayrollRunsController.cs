using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/payroll-runs")]
[Authorize]
public class PayrollRunsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IPayrollCalculationService _payrollCalculationService;

    public PayrollRunsController(PakoDbContext db, IPayrollCalculationService payrollCalculationService)
    {
        _db = db;
        _payrollCalculationService = payrollCalculationService;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<PayrollRunResponse>>> List(Guid companyId)
    {
        var runs = await _db.PayrollRuns.AsNoTracking()
            .Include(r => r.Lines)
            .Where(r => r.CompanyId == companyId)
            .OrderByDescending(r => r.PeriodStart)
            .ToListAsync();

        return Ok(runs.Select(ToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<PayrollRunResponse>> Get(Guid companyId, Guid id)
    {
        var run = await _db.PayrollRuns.AsNoTracking()
            .Include(r => r.Lines)
            .FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);

        if (run is null)
        {
            return NotFound();
        }

        return Ok(ToResponse(run));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(PayrollRunResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PayrollRunResponse>> Create(Guid companyId, CreatePayrollRunRequest request)
    {
        if (request.PeriodEnd < request.PeriodStart)
        {
            return BadRequest("periodEnd must be on or after periodStart.");
        }

        var activeEmployees = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.IsActive)
            .ToListAsync();

        if (activeEmployees.Count == 0)
        {
            return BadRequest("Company has no active employees for a payroll run.");
        }

        var annualPitBrackets = KosovoPersonalIncomeTaxBrackets.Brackets
            .Select(b => new PitBracket(b.LowerBoundEurPerYear, b.UpperBoundEurPerYear, b.Rate))
            .ToList();

        var lines = activeEmployees.Select(employee =>
        {
            var result = _payrollCalculationService.Compute(
                employee.MonthlyGrossSalary,
                annualPitBrackets,
                KosovoPensionContribution.EmployeeRate,
                KosovoPensionContribution.EmployerRate);
            return new PayslipLine
            {
                Id = Guid.NewGuid(),
                EmployeeId = employee.Id,
                GrossSalary = result.GrossSalary,
                PitAmount = result.PitAmount,
                EmployeePensionAmount = result.EmployeePensionAmount,
                EmployerPensionAmount = result.EmployerPensionAmount,
                NetPay = result.NetPay
            };
        }).ToList();

        var payrollRun = new PayrollRun
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            PeriodStart = request.PeriodStart,
            PeriodEnd = request.PeriodEnd,
            Lines = lines
        };

        _db.PayrollRuns.Add(payrollRun);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(payrollRun));
    }

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<PayrollRunResponse>> Post(Guid companyId, Guid id)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            return NotFound();
        }

        var payrollRun = await _db.PayrollRuns.Include(r => r.Lines)
            .FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (payrollRun is null)
        {
            return NotFound();
        }

        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId);
        if (journal is null)
        {
            return BadRequest("Company has no journal to post into.");
        }

        var accountsByCode = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .ToDictionaryAsync(a => a.Code, a => a.Id);

        string[] requiredCodes =
        {
            DefaultChartOfAccountsTemplate.SalaryExpenseAccountCode,
            DefaultChartOfAccountsTemplate.PitPayableAccountCode,
            DefaultChartOfAccountsTemplate.PensionPayableAccountCode,
            DefaultChartOfAccountsTemplate.NetPayPayableAccountCode
        };
        foreach (var code in requiredCodes)
        {
            if (!accountsByCode.ContainsKey(code))
            {
                return BadRequest($"Company has no {code} account seeded.");
            }
        }

        JournalEntry journalEntry;
        try
        {
            journalEntry = payrollRun.Post(
                company,
                journal.Id,
                accountsByCode[DefaultChartOfAccountsTemplate.SalaryExpenseAccountCode],
                accountsByCode[DefaultChartOfAccountsTemplate.PitPayableAccountCode],
                accountsByCode[DefaultChartOfAccountsTemplate.PensionPayableAccountCode],
                accountsByCode[DefaultChartOfAccountsTemplate.NetPayPayableAccountCode]);
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException)
        {
            return BadRequest(ex.Message);
        }

        _db.JournalEntries.Add(journalEntry);
        await _db.SaveChangesAsync();

        return Ok(ToResponse(payrollRun));
    }

    private static PayrollRunResponse ToResponse(PayrollRun r) => new(
        r.Id,
        r.PeriodStart,
        r.PeriodEnd,
        r.State.ToString(),
        r.JournalEntryId,
        r.Lines.Select(l => new PayslipLineResponse(
            l.Id, l.EmployeeId, l.GrossSalary, l.PitAmount, l.EmployeePensionAmount, l.EmployerPensionAmount, l.NetPay)).ToList());
}
