using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
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
        var taxes = await _db.TaxDefinitions.AsNoTracking()
            .Where(t => t.CompanyId == companyId && t.IsActive)
            .OrderBy(t => t.Name)
            .ToListAsync();

        return Ok(taxes
            .Select(t => new TaxDefinitionResponse(t.Id, t.Name, t.Rate, t.Type, t.Scope, t.IsActive))
            .ToList());
    }
}
