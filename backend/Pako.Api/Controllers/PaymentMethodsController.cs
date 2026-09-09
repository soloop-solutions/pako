using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// C4: "the payment form today asks for a cash-or-bank account, which is bookkeeping vocabulary
// aimed at a user who thinks in 'cash' and 'bank transfer'." PaymentMethod is the user-facing
// register (Kind + a friendly Name) sitting in front of the ledger account it's bound to —
// RecordPaymentForm/InvoiceForm/BillForm pick a PaymentMethod, never an Account directly.
[ApiController]
[Route("api/companies/{companyId:guid}/payment-methods")]
[Authorize]
public class PaymentMethodsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PaymentMethodsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<PaymentMethodResponse>>> List(Guid companyId)
    {
        var methods = await _db.PaymentMethods.AsNoTracking()
            .Where(m => m.CompanyId == companyId)
            .OrderBy(m => m.Kind).ThenBy(m => m.Name)
            .ToListAsync();

        return Ok(methods.Select(ToResponse).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(PaymentMethodResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PaymentMethodResponse>> Create(Guid companyId, CreatePaymentMethodRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(_localizer["PaymentMethodNameRequired"].Value);
        }

        var account = await _db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.LedgerAccountId && a.CompanyId == companyId);
        if (account is null || (account.AccountSubType != AccountSubType.Cash && account.AccountSubType != AccountSubType.Bank))
        {
            return BadRequest(_localizer["InvalidPaymentMethodAccount"].Value);
        }

        var method = new PaymentMethod
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Name = request.Name,
            Kind = request.Kind,
            LedgerAccountId = request.LedgerAccountId
        };

        _db.PaymentMethods.Add(method);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(method));
    }

    private static PaymentMethodResponse ToResponse(PaymentMethod m) => new(m.Id, m.Name, m.Kind, m.LedgerAccountId);
}
