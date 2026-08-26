using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/accounts")]
[Authorize]
public class AccountsController : ControllerBase
{
    private readonly PakoDbContext _db;

    public AccountsController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<AccountResponse>>> List(Guid companyId)
    {
        var accounts = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .OrderBy(a => a.Code)
            .ToListAsync();

        return Ok(accounts
            .Select(a => new AccountResponse(a.Id, a.Code, a.Name, a.AccountType, a.AccountSubType, a.ParentAccountId, a.IsReconcilable))
            .ToList());
    }
}
