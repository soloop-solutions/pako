using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Npgsql;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/partners")]
[Authorize]
public class PartnersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;

    public PartnersController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access)
    {
        _db = db;
        _localizer = localizer;
        _access = access;
    }

    // Reads stay AccessModule.None (every document form needs the partner picker) but are
    // partner-filtered: a partner-scoped staff user sees only their assigned partners.
    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<PartnerResponse>>> List(Guid companyId)
    {
        var partners = await _db.Partners.AsNoTracking().VisibleTo(_access)
            .Where(p => p.CompanyId == companyId)
            .OrderBy(p => p.Name)
            .ToListAsync();

        return Ok(partners.Select(ToResponse).ToList());
    }

    [HttpGet("{partnerId:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<PartnerResponse>> Get(Guid companyId, Guid partnerId)
    {
        var partner = await _db.Partners.AsNoTracking().VisibleTo(_access)
            .FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);

        if (partner is null) return NotFound();
        return Ok(ToResponse(partner));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Partners)]
    [ProducesResponseType(typeof(PartnerResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PartnerResponse>> Create(Guid companyId, CreatePartnerRequest request)
    {
        var validationError = await ValidateAsync(companyId, request.Name, request.TaxNumber, request.FiscalNumber, request.ReceivableAccountId, request.PayableAccountId, request.CreditLimit);
        if (validationError is not null) return validationError;

        var partner = new Partner
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Name = request.Name,
            TaxNumber = request.TaxNumber?.Trim(),
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

        // A partner-scoped user would otherwise create a partner they can't see (or invoice)
        // afterwards — the creator is assigned to it in the same SaveChanges.
        if (_access.IsPartnerRestricted && _access.EmployeeId is { } employeeId)
        {
            _db.EmployeePartnerAssignments.Add(new EmployeePartnerAssignment
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                EmployeeId = employeeId,
                PartnerId = partner.Id
            });
        }

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (IsTaxNumberUniqueViolation(ex))
        {
            return Conflict(_localizer["PartnerTaxNumberAlreadyExists"].Value);
        }

        return StatusCode(StatusCodes.Status201Created, ToResponse(partner));
    }

    [HttpPut("{partnerId:guid}")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Partners)]
    public async Task<ActionResult<PartnerResponse>> Update(Guid companyId, Guid partnerId, UpdatePartnerRequest request)
    {
        var partner = await _db.Partners.VisibleTo(_access).FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);
        if (partner is null) return NotFound();

        var validationError = await ValidateAsync(companyId, request.Name, request.TaxNumber, request.FiscalNumber, request.ReceivableAccountId, request.PayableAccountId, request.CreditLimit, partnerId);
        if (validationError is not null) return validationError;

        partner.Name = request.Name;
        partner.TaxNumber = request.TaxNumber?.Trim();
        partner.IsCustomer = request.IsCustomer;
        partner.IsVendor = request.IsVendor;
        partner.FiscalNumber = request.FiscalNumber;
        partner.IsVatRegistered = request.IsVatRegistered;
        partner.ReceivableAccountId = request.ReceivableAccountId;
        partner.PayableAccountId = request.PayableAccountId;
        partner.PaymentTermDays = request.PaymentTermDays;
        partner.CreditLimit = request.CreditLimit;

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (IsTaxNumberUniqueViolation(ex))
        {
            return Conflict(_localizer["PartnerTaxNumberAlreadyExists"].Value);
        }
        return Ok(ToResponse(partner));
    }

    [HttpGet("{partnerId:guid}/credit-exposure")]
    [RequireCompanyAccess]
    public async Task<ActionResult<CreditExposureResponse>> CreditExposure(Guid companyId, Guid partnerId)
    {
        var partner = await _db.Partners.AsNoTracking().VisibleTo(_access)
            .FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);
        if (partner is null) return NotFound();

        var defaults = await _db.CompanyAccountDefaults.AsNoTracking()
            .FirstOrDefaultAsync(d => d.CompanyId == companyId);
        var receivableAccountId = partner.ReceivableAccountId ?? defaults?.ReceivableAccountId ?? Guid.Empty;

        var outstanding = await _db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == Domain.Ledger.JournalEntryState.Posted
                && l.AccountId == receivableAccountId
                && l.PartnerId == partnerId)
            .SumAsync(l => l.Debit - l.Credit);
        if (outstanding < 0) outstanding = 0;

        decimal? available = partner.CreditLimit.HasValue ? partner.CreditLimit.Value - outstanding : null;

        return Ok(new CreditExposureResponse(partner.CreditLimit, outstanding, available));
    }

    private async Task<ActionResult?> ValidateAsync(Guid companyId, string name, string? taxNumber, string? fiscalNumber,
        Guid? receivableAccountId, Guid? payableAccountId, decimal? creditLimit = null, Guid? excludePartnerId = null)
    {
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(_localizer["PartnerNameRequired"].Value);

        if (!string.IsNullOrWhiteSpace(taxNumber))
        {
            var normalizedTaxNumber = taxNumber.Trim();
            var duplicateExists = await _db.Partners.AsNoTracking()
                .AnyAsync(p => p.CompanyId == companyId
                            && p.TaxNumber == normalizedTaxNumber
                            && (excludePartnerId == null || p.Id != excludePartnerId));
            if (duplicateExists)
                return Conflict(_localizer["PartnerTaxNumberAlreadyExists"].Value);
        }

        if (fiscalNumber is { Length: > 64 })
            return BadRequest(_localizer["PartnerFiscalNumberTooLong"].Value);

        if (creditLimit is < 0)
            return BadRequest(_localizer["CreditLimitNegative"].Value);

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

    private static bool IsTaxNumberUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "IX_partners_CompanyId_TaxNumber_Unique" };

    private static PartnerResponse ToResponse(Partner p) => new(
        p.Id, p.Name, p.TaxNumber, p.IsCustomer, p.IsVendor, p.FiscalNumber, p.IsVatRegistered,
        p.ReceivableAccountId, p.PayableAccountId, p.PaymentTermDays, p.CreditLimit);
}
