using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Bills;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reconciliations")]
[Authorize]
public class ReconciliationsController : ControllerBase
{
    private readonly PakoDbContext _db;

    public ReconciliationsController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(ReconciliationResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ReconciliationResponse>> Create(Guid companyId, CreateReconciliationRequest request)
    {
        if (request.InvoiceId is null == request.BillId is null)
        {
            return BadRequest("Exactly one of invoiceId or billId must be set.");
        }

        var settlementLine = await _db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .FirstOrDefaultAsync(l => l.Id == request.JournalEntryLineId);
        if (settlementLine?.JournalEntry is null || settlementLine.JournalEntry.CompanyId != companyId)
        {
            return BadRequest("Invalid settlement journal entry line for this company.");
        }

        Guid documentId;
        Guid documentPartnerId;
        Guid? documentJournalEntryId;
        bool documentIsPosted;
        string controlAccountCode;

        if (request.InvoiceId is { } invoiceId)
        {
            var invoice = await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == invoiceId && i.CompanyId == companyId);
            if (invoice is null)
            {
                return NotFound();
            }

            documentId = invoice.Id;
            documentPartnerId = invoice.PartnerId;
            documentJournalEntryId = invoice.JournalEntryId;
            documentIsPosted = invoice.State == InvoiceState.Posted;
            controlAccountCode = DefaultChartOfAccountsTemplate.AccountsReceivableCode;
        }
        else
        {
            var bill = await _db.Bills.AsNoTracking().FirstOrDefaultAsync(b => b.Id == request.BillId && b.CompanyId == companyId);
            if (bill is null)
            {
                return NotFound();
            }

            documentId = bill.Id;
            documentPartnerId = bill.PartnerId;
            documentJournalEntryId = bill.JournalEntryId;
            documentIsPosted = bill.State == BillState.Posted;
            controlAccountCode = DefaultChartOfAccountsTemplate.AccountsPayableCode;
        }

        var controlAccountId = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.Code == controlAccountCode)
            .Select(a => a.Id)
            .FirstOrDefaultAsync();

        var documentTotal = 0m;
        if (documentJournalEntryId is { } journalEntryId)
        {
            documentTotal = await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntryId == journalEntryId && l.AccountId == controlAccountId)
                .SumAsync(l => l.Debit + l.Credit);
        }

        var alreadyReconciled = await _db.Reconciliations.AsNoTracking()
            .Where(r => (request.InvoiceId != null && r.InvoiceId == request.InvoiceId) ||
                        (request.BillId != null && r.BillId == request.BillId))
            .SumAsync(r => r.Amount);

        try
        {
            ReconciliationValidator.Validate(
                request.JournalEntryLineId,
                settlementLine.JournalEntry.State == JournalEntryState.Posted,
                settlementLine.AccountId,
                controlAccountId,
                settlementLine.PartnerId,
                documentId,
                documentIsPosted,
                documentPartnerId,
                documentTotal,
                alreadyReconciled,
                request.Amount);
        }
        catch (Exception ex) when (
            ex is ArgumentException or
            UnpostedSettlementLineException or
            UnpostedReconciliationDocumentException or
            ReconciliationAccountMismatchException or
            ReconciliationPartnerMismatchException or
            OverReconciliationException)
        {
            return BadRequest(ex.Message);
        }

        var reconciliation = request.InvoiceId is { } invId
            ? Reconciliation.ForInvoice(companyId, invId, request.JournalEntryLineId, request.Amount)
            : Reconciliation.ForBill(companyId, request.BillId!.Value, request.JournalEntryLineId, request.Amount);

        _db.Reconciliations.Add(reconciliation);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(reconciliation));
    }

    [HttpGet]
    [Route("~/api/companies/{companyId:guid}/invoices/{invoiceId:guid}/reconciliations")]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<ReconciliationResponse>>> ListForInvoice(Guid companyId, Guid invoiceId)
    {
        var exists = await _db.Invoices.AsNoTracking().AnyAsync(i => i.Id == invoiceId && i.CompanyId == companyId);
        if (!exists)
        {
            return NotFound();
        }

        var list = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.CompanyId == companyId && r.InvoiceId == invoiceId)
            .OrderBy(r => r.ReconciledAt)
            .ToListAsync();

        return Ok(list.Select(ToResponse).ToList());
    }

    [HttpGet]
    [Route("~/api/companies/{companyId:guid}/bills/{billId:guid}/reconciliations")]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<ReconciliationResponse>>> ListForBill(Guid companyId, Guid billId)
    {
        var exists = await _db.Bills.AsNoTracking().AnyAsync(b => b.Id == billId && b.CompanyId == companyId);
        if (!exists)
        {
            return NotFound();
        }

        var list = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.CompanyId == companyId && r.BillId == billId)
            .OrderBy(r => r.ReconciledAt)
            .ToListAsync();

        return Ok(list.Select(ToResponse).ToList());
    }

    private static ReconciliationResponse ToResponse(Reconciliation r) =>
        new(r.Id, r.InvoiceId, r.BillId, r.JournalEntryLineId, r.Amount, r.ReconciledAt);
}
