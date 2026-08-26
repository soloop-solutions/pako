using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Bills;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/bills")]
[Authorize]
public class BillsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly ITaxComputationService _taxComputationService;

    public BillsController(PakoDbContext db, ITaxComputationService taxComputationService)
    {
        _db = db;
        _taxComputationService = taxComputationService;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<BillResponse>>> List(Guid companyId)
    {
        var bills = await _db.Bills.AsNoTracking()
            .Include(b => b.Lines)
            .Where(b => b.CompanyId == companyId)
            .OrderByDescending(b => b.IssueDate)
            .ToListAsync();

        return Ok(bills.Select(ToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<BillResponse>> Get(Guid companyId, Guid id)
    {
        var bill = await _db.Bills.AsNoTracking()
            .Include(b => b.Lines)
            .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);

        if (bill is null)
        {
            return NotFound();
        }

        return Ok(ToResponse(bill));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(BillResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<BillResponse>> Create(Guid companyId, CreateBillRequest request)
    {
        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null || !partner.IsVendor)
        {
            return BadRequest("Invalid vendor partner for this company.");
        }

        if (request.Lines.Count == 0)
        {
            return BadRequest("Bill must have at least one line.");
        }

        var accountsByCode = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .ToDictionaryAsync(a => a.Code, a => a.Id);
        var validAccountIds = accountsByCode.Values.ToHashSet();

        if (!accountsByCode.TryGetValue(DefaultChartOfAccountsTemplate.DefaultExpenseAccountCode, out var defaultExpenseAccountId))
        {
            return BadRequest("Company has no default expense account seeded.");
        }

        var lines = new List<BillLine>();
        foreach (var line in request.Lines)
        {
            var expenseAccountId = line.ExpenseAccountId ?? defaultExpenseAccountId;
            if (!validAccountIds.Contains(expenseAccountId))
            {
                return BadRequest($"Expense account {expenseAccountId} does not belong to this company.");
            }

            lines.Add(new BillLine
            {
                Id = Guid.NewGuid(),
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                TaxDefinitionId = line.TaxDefinitionId,
                ExpenseAccountId = expenseAccountId
            });
        }

        var bill = new Bill
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            PartnerId = request.PartnerId,
            VendorReference = request.VendorReference,
            IssueDate = request.IssueDate,
            DueDate = request.DueDate,
            Lines = lines
        };

        _db.Bills.Add(bill);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(bill));
    }

    [HttpGet("{id:guid}/balance")]
    [RequireCompanyAccess]
    public async Task<ActionResult<DocumentBalanceResponse>> Balance(Guid companyId, Guid id)
    {
        var bill = await _db.Bills.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        var total = 0m;
        if (bill.JournalEntryId is { } journalEntryId)
        {
            var payableAccountId = await _db.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.Code == DefaultChartOfAccountsTemplate.AccountsPayableCode)
                .Select(a => a.Id)
                .FirstOrDefaultAsync();
            total = await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntryId == journalEntryId && l.AccountId == payableAccountId)
                .SumAsync(l => l.Credit);
        }

        var reconciled = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.BillId == id)
            .SumAsync(r => r.Amount);

        return Ok(new DocumentBalanceResponse(total, reconciled, total - reconciled));
    }

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<BillResponse>> Post(Guid companyId, Guid id)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            return NotFound();
        }

        var bill = await _db.Bills.Include(b => b.Lines)
            .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId);
        if (journal is null)
        {
            return BadRequest("Company has no journal to post into.");
        }

        var payableAccountId = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.Code == DefaultChartOfAccountsTemplate.AccountsPayableCode)
            .Select(a => a.Id)
            .FirstOrDefaultAsync();
        if (payableAccountId == Guid.Empty)
        {
            return BadRequest("Company has no Accounts Payable account seeded.");
        }

        var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
            .Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId)
            .ToDictionaryAsync(t => t.Id);

        JournalEntry journalEntry;
        try
        {
            journalEntry = bill.Post(company, journal.Id, payableAccountId, _taxComputationService, taxDefinitionsById);
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

        return Ok(ToResponse(bill));
    }

    private static BillResponse ToResponse(Bill b) => new(
        b.Id,
        b.PartnerId,
        b.VendorReference,
        b.IssueDate,
        b.DueDate,
        b.State.ToString(),
        b.JournalEntryId,
        b.Lines.Select(l => new BillLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.ExpenseAccountId)).ToList());
}
