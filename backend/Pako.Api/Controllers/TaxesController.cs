using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/taxes")]
[Authorize]
public class TaxesController : ControllerBase
{
    private readonly PakoDbContext _db;

    public TaxesController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<TaxDefinitionResponse>>> List(Guid companyId)
    {
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        var taxes = await _db.TaxDefinitions.AsNoTracking()
            .Where(t => t.CompanyId == companyId && t.IsActive)
            .OrderBy(t => t.Name)
            .ToListAsync();

        // Filter to only eligible codes for this company's VAT status.
        // Non-VAT companies see only NA, withholding, and Direction.None codes.
        // VAT companies see everything.
        var eligible = taxes
            .Where(t => VatEligibilityValidator.IsEligible(company.IsVatRegistered, t))
            .Select(t => new TaxDefinitionResponse(t.Id, t.Name, t.Rate, t.Type, t.Scope, t.IsActive, t.Code, t.Direction, t.IsReverseCharge))
            .ToList();

        return Ok(eligible);
    }
}
