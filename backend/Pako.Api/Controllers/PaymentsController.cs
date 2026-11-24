using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using System.Security.Claims;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Payments;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId}/payments")]
[Authorize]
public class PaymentsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access) : ControllerBase
{
    private string? CurrentUserId => User.FindFirstValue(ClaimTypes.NameIdentifier);

    // Direct payments (2026-11-24): money received from a customer or paid to a vendor with no
    // document, posted to the partner's balance (PaymentRecorder.ForPartnerAsync) and optionally
    // applied to its open invoices/bills at once (PaymentApplier), all in one transaction.
    // Received needs Sales: Approve, paid needs Purchases: Approve — as "Record payment" does.
    [HttpPost(Name = "CreatePayment")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(PaymentResponse), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create(Guid companyId, CreatePaymentRequest request)
    {
        if (!Enum.TryParse<PaymentDirection>(request.Direction, true, out var direction) || !Enum.IsDefined(direction))
        {
            return BadRequest(localizer["PaymentDirectionInvalid"].Value);
        }

        if (!MayPay(direction)) return Forbid();
        if (request.Amount <= 0) return BadRequest(localizer["AmountMustBePositive"].Value);

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        var partner = await db.Partners.AsNoTracking().VisibleTo(access)
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null) return BadRequest(localizer["AssignedPartnerNotFound"].Value);

        var cashOrBankAccount = await db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.CashOrBankAccountId && a.CompanyId == companyId);
        if (cashOrBankAccount is null || (cashOrBankAccount.AccountSubType != AccountSubType.Cash && cashOrBankAccount.AccountSubType != AccountSubType.Bank))
        {
            return BadRequest(localizer["InvalidCashOrBankAccount"].Value);
        }

        try { await MonthLockService.EnsureMonthOpenAsync(db, companyId, request.Date); }
        catch (MonthLockViolationException ex) { return BadRequest(ex.Message); }

        var transaction = db.Database.SupportsRowLocking() ? await db.Database.BeginTransactionAsync() : null;
        try
        {
            var (payment, _, error) = await new PaymentRecorder(db, localizer).ForPartnerAsync(company, direction, partner.Id,
                request.Amount, cashOrBankAccount.Id, request.Date, request.Reference, CurrentUserId);
            if (error is not null) return BadRequest(error);
            await db.SaveChangesAsync();

            var applyError = await new PaymentApplier(db, localizer).ApplyAsync(companyId, payment!, request.Allocations ?? []);
            if (applyError is not null) return BadRequest(applyError);

            AuditController.Stage(db, companyId, "Payment", payment!.Id.ToString(), "Created", CurrentUserId ?? "",
                $"Direction={direction}, Amount={request.Amount}, Allocations={request.Allocations?.Count ?? 0}");
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();

            var responses = await ToResponsesAsync(companyId, [payment]);
            return StatusCode(StatusCodes.Status201Created, responses[0]);
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();
        }
    }

    // The partner's posted invoices (direction Inbound) or bills (Outbound) a payment can apply to,
    // with what each still owes; with an amount, the server's oldest-first suggestion.
    [HttpGet("open-documents", Name = "ListPaymentOpenDocuments")]
    [RequireCompanyAccess]
    [ProducesResponseType(typeof(List<OpenDocumentResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> OpenDocuments(Guid companyId, [FromQuery] Guid partnerId, [FromQuery] string direction,
        [FromQuery] decimal? amount = null)
    {
        if (!Enum.TryParse<PaymentDirection>(direction, true, out var dir) || !Enum.IsDefined(dir))
        {
            return BadRequest(localizer["PaymentDirectionInvalid"].Value);
        }

        if (access.LevelFor(dir == PaymentDirection.Inbound ? AccessModule.Sales : AccessModule.Purchases) < AccessLevel.Read
            || !access.CanSeePartner(partnerId))
        {
            return Forbid();
        }

        return Ok(await new PaymentApplier(db, localizer).OpenDocumentsAsync(companyId, partnerId, dir, amount));
    }

    // Applies (more of) a payment to the partner's open invoices/bills, all or nothing.
    [HttpPost("{paymentId:guid}/apply", Name = "ApplyPayment")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(PaymentResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> Apply(Guid companyId, Guid paymentId, ApplyPaymentRequest request)
    {
        var payment = await db.Payments.AsNoTracking().FirstOrDefaultAsync(p => p.Id == paymentId && p.CompanyId == companyId);
        if (payment is null || !access.CanSeePartner(payment.PartnerId)) return NotFound();
        if (!MayPay(payment.Direction)) return Forbid();

        var transaction = db.Database.SupportsRowLocking() ? await db.Database.BeginTransactionAsync() : null;
        try
        {
            var error = await new PaymentApplier(db, localizer).ApplyAsync(companyId, payment, request.Allocations ?? []);
            if (error is not null) return BadRequest(error);

            AuditController.Stage(db, companyId, "Payment", payment.Id.ToString(), "Applied", CurrentUserId ?? "",
                $"Allocations={request.Allocations?.Count ?? 0}");
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Ok((await ToResponsesAsync(companyId, [payment]))[0]);
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();
        }
    }

    private bool MayPay(PaymentDirection direction) =>
        access.LevelFor(direction == PaymentDirection.Inbound ? AccessModule.Sales : AccessModule.Purchases) >= AccessLevel.Approve;

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
        // A direct-to-cash payment is created Reconciled (no bank step to wait for) and can still be
        // cancelled; one cleared by a bank statement cannot.
        if (payment.State == PaymentState.Reconciled && !payment.IsDirectToCash)
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
        // Every document the payment was applied to (one for a document payment, any number for a
        // direct payment) gets its amount back.
        if (controlLineId is { } clId)
        {
            db.Reconciliations.RemoveRange(await db.Reconciliations.Where(r => r.JournalEntryLineId == clId).ToListAsync());
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

        var unapplied = await new PaymentApplier(db, localizer).UnappliedAsync(payments);

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
                p.BankStatementLineId, p.CreatedAt,
                unapplied.GetValueOrDefault(p.Id).Unapplied, unapplied.GetValueOrDefault(p.Id).AppliedCount);
        }).ToList();
    }
}
