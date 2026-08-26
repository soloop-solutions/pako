using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Reconciliation;
using Pako.Infrastructure;

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

        // Row-locking the settlement line (Postgres only) before reading how much of it is
        // already reconciled serializes concurrent reconciliation attempts against the same line
        // — without it, two concurrent requests could both read "0 already reconciled" and both
        // pass validation, double-spending the line. See ReconciliationCreator's comment for the
        // validation itself.
        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            if (transaction is not null)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM journal_entry_lines WHERE \"Id\" = {request.JournalEntryLineId} FOR UPDATE");
            }

            var result = await ReconciliationCreator.TryCreateAsync(
                _db, companyId, request.InvoiceId, request.BillId, request.JournalEntryLineId, request.Amount);

            if (result.Status == ReconciliationCreationStatus.NotFound)
            {
                return NotFound();
            }

            if (result.Status == ReconciliationCreationStatus.ValidationFailed)
            {
                return BadRequest(result.Error);
            }

            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            return StatusCode(StatusCodes.Status201Created, ToResponse(result.Reconciliation!));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
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
