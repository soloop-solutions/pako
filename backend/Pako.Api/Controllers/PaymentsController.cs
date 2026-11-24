using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Payments;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId}/payments")]
[Authorize]
public class PaymentsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer) : ControllerBase
{
    [HttpGet]
    [RequireCompanyAccess]
    [ProducesResponseType(typeof(PaymentListResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> List(Guid companyId,
        [FromQuery] string? state = null, [FromQuery] string? direction = null,
        [FromQuery] Guid? partnerId = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        [FromQuery] string? sort = null)
    {
        var query = db.Payments.AsNoTracking().Where(p => p.CompanyId == companyId);

        if (Enum.TryParse<PaymentState>(state, true, out var stateFilter))
            query = query.Where(p => p.State == stateFilter);
        if (Enum.TryParse<PaymentDirection>(direction, true, out var dirFilter))
            query = query.Where(p => p.Direction == dirFilter);
        if (partnerId is not null)
            query = query.Where(p => p.PartnerId == partnerId);

        var total = await query.CountAsync();

        query = sort?.ToLowerInvariant() switch
        {
            "date" => query.OrderBy(p => p.Date),
            "-date" => query.OrderByDescending(p => p.Date),
            "amount" => query.OrderBy(p => p.Amount),
            "-amount" => query.OrderByDescending(p => p.Amount),
            _ => query.OrderByDescending(p => p.Date).ThenByDescending(p => p.CreatedAt),
        };

        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var responses = await ToResponsesAsync(companyId, items);
        return Ok(new PaymentListResponse(responses, total, page, pageSize));
    }

    [HttpGet("outstanding")]
    [RequireCompanyAccess]
    [ProducesResponseType(typeof(List<PaymentResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Outstanding(Guid companyId)
    {
        var items = await db.Payments.AsNoTracking()
            .Where(p => p.CompanyId == companyId && p.State == PaymentState.Posted)
            .OrderBy(p => p.Date).ThenBy(p => p.CreatedAt)
            .ToListAsync();
        var responses = await ToResponsesAsync(companyId, items);
        return Ok(responses);
    }

    [HttpGet("{paymentId}")]
    [RequireCompanyAccess]
    [ProducesResponseType(typeof(PaymentResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> Detail(Guid companyId, Guid paymentId)
    {
        var payment = await db.Payments.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == paymentId && p.CompanyId == companyId);
        if (payment is null) return NotFound();
        var responses = await ToResponsesAsync(companyId, [payment]);
        return Ok(responses[0]);
    }

    [HttpPost("{paymentId}/cancel")]
    [RequireCompanyAccess(writeAccess: true, approve: true)]
    public async Task<IActionResult> Cancel(Guid companyId, Guid paymentId)
    {
        var payment = await db.Payments.FirstOrDefaultAsync(p => p.Id == paymentId && p.CompanyId == companyId);
        if (payment is null) return NotFound();

        if (payment.State == PaymentState.Cancelled)
            return BadRequest(localizer["PaymentAlreadyCancelled"].Value);
        if (payment.State == PaymentState.Reconciled)
            return BadRequest(localizer["PaymentNotOutstanding"].Value);

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        // Reverse the settlement JE
        var entry = await db.JournalEntries.Include(e => e.Lines)
            .FirstOrDefaultAsync(e => e.Id == payment.JournalEntryId);
        if (entry is not null)
        {
            var reversal = entry.Reverse(company, DateOnly.FromDateTime(DateTime.UtcNow));
            db.JournalEntries.Add(reversal);
        }

        // Remove the reconciliation that was created for this payment
        var controlLineId = entry?.Lines.FirstOrDefault(l => l.AccountId != payment.OutstandingAccountId)?.Id;
        Domain.Reconciliation.Reconciliation? reconciliation = null;
        if (controlLineId is { } clId)
        {
            reconciliation = payment.InvoiceId is not null
                ? await db.Reconciliations.FirstOrDefaultAsync(r => r.InvoiceId == payment.InvoiceId && r.JournalEntryLineId == clId)
                : payment.BillId is not null
                    ? await db.Reconciliations.FirstOrDefaultAsync(r => r.BillId == payment.BillId && r.JournalEntryLineId == clId)
                    : null;
        }

        if (reconciliation is not null)
        {
            db.Reconciliations.Remove(reconciliation);
        }

        payment.State = PaymentState.Cancelled;
        await db.SaveChangesAsync();
        return Ok();
    }

    private async Task<List<PaymentResponse>> ToResponsesAsync(Guid companyId, List<Payment> payments)
    {
        if (payments.Count == 0) return [];

        var partnerIds = payments.Select(p => p.PartnerId).Distinct().ToList();
        var partnerNames = await db.Partners.AsNoTracking()
            .Where(p => p.CompanyId == companyId && partnerIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name);

        var accountIds = payments.Select(p => p.DestinationAccountId).Distinct().ToList();
        var accountNames = await db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id, a => $"{a.Code} {a.Name}");

        var invoiceIds = payments.Where(p => p.InvoiceId != null).Select(p => p.InvoiceId!.Value).Distinct().ToList();
        var invoiceNumbers = invoiceIds.Count > 0
            ? await db.Invoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id))
                .ToDictionaryAsync(i => i.Id, i => i.InvoiceNumber ?? string.Empty)
            : new Dictionary<Guid, string>();

        var billIds = payments.Where(p => p.BillId != null).Select(p => p.BillId!.Value).Distinct().ToList();
        var billNumbers = billIds.Count > 0
            ? await db.Bills.AsNoTracking().Where(b => billIds.Contains(b.Id))
                .ToDictionaryAsync(b => b.Id, b => b.VendorReference ?? string.Empty)
            : new Dictionary<Guid, string>();

        return payments.Select(p =>
        {
            var docNumber = p.InvoiceId is { } iid ? invoiceNumbers.GetValueOrDefault(iid)
                : p.BillId is { } bid ? billNumbers.GetValueOrDefault(bid) : null;
            return new PaymentResponse(
                p.Id, p.Direction.ToString(), p.PartnerId,
                partnerNames.GetValueOrDefault(p.PartnerId),
                p.Amount, p.Date, p.Reference, p.State.ToString(),
                p.InvoiceId, p.BillId, docNumber,
                p.DestinationAccountId, accountNames.GetValueOrDefault(p.DestinationAccountId),
                p.BankStatementLineId, p.CreatedAt);
        }).ToList();
    }
}
