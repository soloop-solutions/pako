using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/invoices")]
[Authorize]
public class InvoicesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly ITaxComputationService _taxComputationService;

    public InvoicesController(PakoDbContext db, ITaxComputationService taxComputationService)
    {
        _db = db;
        _taxComputationService = taxComputationService;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<InvoiceResponse>>> List(Guid companyId)
    {
        var invoices = await _db.Invoices.AsNoTracking()
            .Include(i => i.Lines)
            .Where(i => i.CompanyId == companyId)
            .OrderByDescending(i => i.IssueDate)
            .ToListAsync();

        return Ok(invoices.Select(ToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<InvoiceResponse>> Get(Guid companyId, Guid id)
    {
        var invoice = await _db.Invoices.AsNoTracking()
            .Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);

        if (invoice is null)
        {
            return NotFound();
        }

        return Ok(ToResponse(invoice));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(InvoiceResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<InvoiceResponse>> Create(Guid companyId, CreateInvoiceRequest request)
    {
        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null || !partner.IsCustomer)
        {
            return BadRequest("Invalid customer partner for this company.");
        }

        if (request.Lines.Count == 0)
        {
            return BadRequest("Invoice must have at least one line.");
        }

        var accountsByCode = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .ToDictionaryAsync(a => a.Code, a => a.Id);
        var validAccountIds = accountsByCode.Values.ToHashSet();

        if (!accountsByCode.TryGetValue(DefaultChartOfAccountsTemplate.DefaultRevenueAccountCode, out var defaultRevenueAccountId))
        {
            return BadRequest("Company has no default revenue account seeded.");
        }

        var lines = new List<InvoiceLine>();
        foreach (var line in request.Lines)
        {
            var revenueAccountId = line.RevenueAccountId ?? defaultRevenueAccountId;
            if (!validAccountIds.Contains(revenueAccountId))
            {
                return BadRequest($"Revenue account {revenueAccountId} does not belong to this company.");
            }

            lines.Add(new InvoiceLine
            {
                Id = Guid.NewGuid(),
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                TaxDefinitionId = line.TaxDefinitionId,
                RevenueAccountId = revenueAccountId
            });
        }

        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            PartnerId = request.PartnerId,
            IssueDate = request.IssueDate,
            DueDate = request.DueDate,
            Lines = lines
        };

        _db.Invoices.Add(invoice);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(invoice));
    }

    [HttpGet("{id:guid}/balance")]
    [RequireCompanyAccess]
    public async Task<ActionResult<DocumentBalanceResponse>> Balance(Guid companyId, Guid id)
    {
        var invoice = await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        var total = 0m;
        if (invoice.JournalEntryId is { } journalEntryId)
        {
            var receivableAccountId = await _db.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.Code == DefaultChartOfAccountsTemplate.AccountsReceivableCode)
                .Select(a => a.Id)
                .FirstOrDefaultAsync();
            total = await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntryId == journalEntryId && l.AccountId == receivableAccountId)
                .SumAsync(l => l.Debit);
        }

        var reconciled = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId == id)
            .SumAsync(r => r.Amount);

        return Ok(new DocumentBalanceResponse(total, reconciled, total - reconciled));
    }

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<InvoiceResponse>> Post(Guid companyId, Guid id)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            return NotFound();
        }

        var invoice = await _db.Invoices.Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId);
        if (journal is null)
        {
            return BadRequest("Company has no journal to post into.");
        }

        var receivableAccountId = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.Code == DefaultChartOfAccountsTemplate.AccountsReceivableCode)
            .Select(a => a.Id)
            .FirstOrDefaultAsync();
        if (receivableAccountId == Guid.Empty)
        {
            return BadRequest("Company has no Accounts Receivable account seeded.");
        }

        var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
            .Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId)
            .ToDictionaryAsync(t => t.Id);

        JournalEntry journalEntry;
        try
        {
            journalEntry = invoice.Post(company, journal.Id, receivableAccountId, _taxComputationService, taxDefinitionsById);
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

        return Ok(ToResponse(invoice));
    }

    private static InvoiceResponse ToResponse(Invoice i) => new(
        i.Id,
        i.PartnerId,
        i.InvoiceNumber,
        i.IssueDate,
        i.DueDate,
        i.State.ToString(),
        i.JournalEntryId,
        i.Lines.Select(l => new InvoiceLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.RevenueAccountId)).ToList());
}
