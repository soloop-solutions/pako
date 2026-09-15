using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// B2: read-only — groups are seeded once per company at creation (CompaniesController.Create,
// via AccountGroupTemplate.BuildForCompany) and never hand-edited, so there is no write API here.
[ApiController]
[Route("api/companies/{companyId:guid}/account-groups")]
[Authorize]
public class AccountGroupsController : ControllerBase
{
    private readonly PakoDbContext _db;

    public AccountGroupsController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<AccountGroupResponse>>> List(Guid companyId)
    {
        var groups = await _db.AccountGroups.AsNoTracking()
            .Where(g => g.CompanyId == companyId)
            .OrderBy(g => g.CodePrefixStart)
            .ToListAsync();

        return Ok(groups
            .Select(g => new AccountGroupResponse(g.Id, g.Name, g.CodePrefixStart, g.CodePrefixEnd, g.ParentGroupId))
            .ToList());
    }
}
