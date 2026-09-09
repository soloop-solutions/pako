using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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

    public PartnersController(PakoDbContext db)
    {
        _db = db;
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

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(PartnerResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PartnerResponse>> Create(Guid companyId, CreatePartnerRequest request)
    {
        if (request.FiscalNumber is { Length: > 64 })
            return BadRequest("Fiscal number must be 64 characters or fewer.");

        var partner = new Partner
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Name = request.Name,
            TaxNumber = request.TaxNumber,
            IsCustomer = request.IsCustomer,
            IsVendor = request.IsVendor,
            FiscalNumber = request.FiscalNumber,
            IsVatRegistered = request.IsVatRegistered
        };

        _db.Partners.Add(partner);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(partner));
    }

    private static PartnerResponse ToResponse(Partner p) => new(p.Id, p.Name, p.TaxNumber, p.IsCustomer, p.IsVendor, p.FiscalNumber, p.IsVatRegistered);
}
