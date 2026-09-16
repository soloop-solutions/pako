using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/partners")]
[Authorize]
public class PartnersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PartnersController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<PartnerResponse>>> List(Guid companyId)
    {
        var partners = await _db.Partners.AsNoTracking()
            .Where(p => p.CompanyId == companyId)
            .OrderBy(p => p.Name)
            .ToListAsync();

        return Ok(partners.Select(ToResponse).ToList());
    }

    [HttpGet("{partnerId:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<PartnerResponse>> Get(Guid companyId, Guid partnerId)
    {
        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);

        if (partner is null) return NotFound();
        return Ok(ToResponse(partner));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(PartnerResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PartnerResponse>> Create(Guid companyId, CreatePartnerRequest request)
    {
        var validationError = await ValidateAsync(companyId, request.Name, request.FiscalNumber, request.ReceivableAccountId, request.PayableAccountId);
        if (validationError is not null) return validationError;

        var partner = new Partner
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Name = request.Name,
            TaxNumber = request.TaxNumber,
            IsCustomer = request.IsCustomer,
            IsVendor = request.IsVendor,
            FiscalNumber = request.FiscalNumber,
            IsVatRegistered = request.IsVatRegistered,
            ReceivableAccountId = request.ReceivableAccountId,
            PayableAccountId = request.PayableAccountId,
            PaymentTermDays = request.PaymentTermDays,
            CreditLimit = request.CreditLimit
        };

        _db.Partners.Add(partner);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(partner));
    }

    [HttpPut("{partnerId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<PartnerResponse>> Update(Guid companyId, Guid partnerId, UpdatePartnerRequest request)
    {
        var partner = await _db.Partners.FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);
        if (partner is null) return NotFound();

        var validationError = await ValidateAsync(companyId, request.Name, request.FiscalNumber, request.ReceivableAccountId, request.PayableAccountId);
        if (validationError is not null) return validationError;

        partner.Name = request.Name;
        partner.TaxNumber = request.TaxNumber;
        partner.IsCustomer = request.IsCustomer;
        partner.IsVendor = request.IsVendor;
        partner.FiscalNumber = request.FiscalNumber;
        partner.IsVatRegistered = request.IsVatRegistered;
        partner.ReceivableAccountId = request.ReceivableAccountId;
        partner.PayableAccountId = request.PayableAccountId;
        partner.PaymentTermDays = request.PaymentTermDays;
        partner.CreditLimit = request.CreditLimit;

        await _db.SaveChangesAsync();
        return Ok(ToResponse(partner));
    }

    private async Task<ActionResult?> ValidateAsync(Guid companyId, string name, string? fiscalNumber, Guid? receivableAccountId, Guid? payableAccountId)
    {
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(_localizer["PartnerNameRequired"].Value);

        if (fiscalNumber is { Length: > 64 })
            return BadRequest(_localizer["PartnerFiscalNumberTooLong"].Value);

        var accountIdsToCheck = new[] { receivableAccountId, payableAccountId }
            .Where(id => id.HasValue).Select(id => id!.Value).ToHashSet();
        if (accountIdsToCheck.Count > 0)
        {
            var validCount = await _db.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && accountIdsToCheck.Contains(a.Id))
                .CountAsync();
            if (validCount != accountIdsToCheck.Count)
                return BadRequest(_localizer["PartnerControlAccountNotBelongToCompany"].Value);
        }

        return null;
    }

    private static PartnerResponse ToResponse(Partner p) => new(
        p.Id, p.Name, p.TaxNumber, p.IsCustomer, p.IsVendor, p.FiscalNumber, p.IsVatRegistered,
        p.ReceivableAccountId, p.PayableAccountId, p.PaymentTermDays, p.CreditLimit);
}
