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

// G10: salary advances and loans. Issuing one pays it out (Dr 111100 employee receivables /
// Cr cash or bank); payroll then recovers it in installments (EmployeeLoanService). A loan can be
// cancelled only while nothing has been recovered — the payout is reversed by storno.
[ApiController]
[Route("api/companies/{companyId:guid}/employee-loans")]
[Authorize]
public class EmployeeLoansController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly EmployeeLoanService _loans;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public EmployeeLoansController(PakoDbContext db, EmployeeLoanService loans, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _loans = loans;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet(Name = "ListEmployeeLoans")]
    [RequireCompanyAccess(module: AccessModule.Payroll)]
    public async Task<ActionResult<List<EmployeeLoanResponse>>> List(Guid companyId, [FromQuery] Guid? employeeId = null, [FromQuery] string? state = null)
    {
        var query = _db.EmployeeLoans.AsNoTracking().Where(l => l.CompanyId == companyId);
        if (employeeId is { } e) query = query.Where(l => l.EmployeeId == e);
        if (Enum.TryParse<EmployeeLoanState>(state, true, out var parsed)) query = query.Where(l => l.State == parsed);

        var loans = await query.OrderByDescending(l => l.IssuedOn).Take(500).ToListAsync();
        return Ok(await ToResponsesAsync(loans));
    }

    [HttpGet("{id:guid}", Name = "GetEmployeeLoan")]
    [RequireCompanyAccess(module: AccessModule.Payroll)]
    public async Task<ActionResult<EmployeeLoanResponse>> Get(Guid companyId, Guid id)
    {
        var loan = await _db.EmployeeLoans.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id && l.CompanyId == companyId);
        return loan is null ? NotFound() : Ok((await ToResponsesAsync(new List<EmployeeLoan> { loan })).Single());
    }

    [HttpPost(Name = "CreateEmployeeLoan")]
    [RequireCompanyAccess(module: AccessModule.Payroll, approve: true)]
    [ProducesResponseType(typeof(EmployeeLoanResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<EmployeeLoanResponse>> Create(Guid companyId, CreateEmployeeLoanRequest request)
    {
        if (request.Principal <= 0m || request.Principal != Math.Round(request.Principal, 2)) return BadRequest(_localizer["LoanPrincipalInvalid"].Value);
        if (request.InstallmentAmount <= 0m || request.InstallmentAmount > request.Principal) return BadRequest(_localizer["LoanInstallmentInvalid"].Value);

        var employee = await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == request.EmployeeId && e.CompanyId == companyId);
        if (employee is null) return BadRequest(_localizer["EmployeeNotFound"].Value);

        var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
        var cashOrBank = await _db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == request.CashOrBankAccountId && a.CompanyId == companyId);
        if (cashOrBank is null || (cashOrBank.AccountSubType != AccountSubType.Cash && cashOrBank.AccountSubType != AccountSubType.Bank))
        {
            return BadRequest(_localizer["InvalidCashOrBankAccount"].Value);
        }

        var advancesAccountId = await _loans.AdvancesAccountIdAsync(companyId);
        if (advancesAccountId is null) return BadRequest(_localizer["NoEmployeeAdvancesAccount"].Value);

        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        var journal = await JournalResolver.GetAsync(_db, companyId, JournalResolver.SettlementJournalType(cashOrBank.AccountSubType));
        if (journal is null) return BadRequest(_localizer["NoJournalToPost"].Value);

        var loan = new EmployeeLoan
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            EmployeeId = employee.Id,
            Kind = request.Kind,
            Principal = request.Principal,
            IssuedOn = request.IssuedOn,
            InstallmentAmount = request.InstallmentAmount,
            FirstPeriod = new DateOnly(request.FirstPeriod.Year, request.FirstPeriod.Month, 1),
            Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim()
        };

        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JournalId = journal.Id,
            Date = request.IssuedOn,
            Reference = $"{loan.Kind}: {employee.Name}",
            SourceDocumentId = loan.Id,
            Lines = new List<JournalEntryLine>
            {
                new() { Id = Guid.NewGuid(), AccountId = advancesAccountId.Value, EmployeeId = employee.Id, Debit = loan.Principal, Description = $"{loan.Kind} to {employee.Name}" },
                new() { Id = Guid.NewGuid(), AccountId = cashOrBank.Id, Credit = loan.Principal, Description = $"{loan.Kind} to {employee.Name}" }
            }
        };

        try
        {
            entry.Post(await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId));
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnbalancedJournalEntryException or AccountingLockDateViolationException
                                       or TaxLockDateViolationException or HardLockDateViolationException)
        {
            return BadRequest(ex.Message);
        }

        entry.PostedByUserId = CurrentUserId;
        entry.SequenceNumber = JournalSequencer.ReserveNext(journal);
        loan.DisbursementJournalEntryId = entry.Id;
        _db.JournalEntries.Add(entry);
        _db.EmployeeLoans.Add(loan);
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();

        return StatusCode(StatusCodes.Status201Created, (await ToResponsesAsync(new List<EmployeeLoan> { loan })).Single());
    }

    [HttpPost("{id:guid}/cancel", Name = "CancelEmployeeLoan")]
    [RequireCompanyAccess(module: AccessModule.Payroll, approve: true)]
    public async Task<ActionResult<EmployeeLoanResponse>> Cancel(Guid companyId, Guid id, [FromQuery] DateOnly? date = null)
    {
        var loan = await _db.EmployeeLoans.FirstOrDefaultAsync(l => l.Id == id && l.CompanyId == companyId);
        if (loan is null) return NotFound();
        if (loan.State != EmployeeLoanState.Active) return BadRequest(_localizer["LoanNotActive"].Value);
        if (await _db.PayrollAdjustments.AnyAsync(a => a.EmployeeLoanId == loan.Id && a.PayrollRunId != null))
        {
            return BadRequest(_localizer["LoanHasRepayments"].Value);
        }

        if (loan.DisbursementJournalEntryId is { } entryId)
        {
            var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
            var entry = await _db.JournalEntries.Include(e => e.Lines).FirstAsync(e => e.Id == entryId);
            var journal = await _db.Journals.FirstAsync(j => j.Id == entry.JournalId);
            JournalEntry reversal;
            try
            {
                reversal = entry.Reverse(await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId),
                    date ?? DateOnly.FromDateTime(DateTime.UtcNow));
            }
            catch (Exception ex) when (ex is InvalidOperationException or AccountingLockDateViolationException
                                           or TaxLockDateViolationException or HardLockDateViolationException)
            {
                return BadRequest(ex.Message);
            }

            reversal.PostedByUserId = CurrentUserId;
            reversal.SourceDocumentId = loan.Id;
            reversal.SequenceNumber = JournalSequencer.ReserveNext(journal);
            _db.JournalEntries.Add(reversal);
            loan.CancellationJournalEntryId = reversal.Id;
        }

        loan.State = EmployeeLoanState.Cancelled;
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(new List<EmployeeLoan> { loan })).Single());
    }

    private async Task<List<EmployeeLoanResponse>> ToResponsesAsync(List<EmployeeLoan> loans)
    {
        var loanIds = loans.Select(l => l.Id).ToList();
        var employeeIds = loans.Select(l => l.EmployeeId).Distinct().ToList();
        var names = await _db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.Name);
        var repayments = await (
            from a in _db.PayrollAdjustments.AsNoTracking()
            join r in _db.PayrollRuns.AsNoTracking() on a.PayrollRunId equals r.Id
            where a.EmployeeLoanId != null && loanIds.Contains(a.EmployeeLoanId.Value)
            orderby a.Period
            select new { LoanId = a.EmployeeLoanId!.Value, Response = new LoanRepaymentResponse(a.Id, r.Id, a.Period, a.Amount, r.State.ToString()) })
            .ToListAsync();

        return loans.Select(l =>
        {
            var mine = repayments.Where(r => r.LoanId == l.Id).Select(r => r.Response).ToList();
            var posted = mine.Where(r => r.RunState is nameof(PayrollRunState.Posted) or nameof(PayrollRunState.Paid)).Sum(r => r.Amount);
            var inDraft = mine.Sum(r => r.Amount) - posted;
            var outstanding = l.Outstanding(posted);
            return new EmployeeLoanResponse(l.Id, l.EmployeeId, names.GetValueOrDefault(l.EmployeeId, string.Empty), l.Kind, l.Principal,
                l.IssuedOn, l.InstallmentAmount, l.FirstPeriod, l.State.ToString(), posted, inDraft, outstanding,
                l.DisbursementJournalEntryId, l.Notes, mine);
        }).ToList();
    }
}
