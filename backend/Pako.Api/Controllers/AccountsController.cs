using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
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

        return Ok(accounts.Select(ToResponse).ToList());
    }

    // CONTRACT STUB — replaced in B1
    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(AccountResponse), StatusCodes.Status201Created)]
    public ActionResult<AccountResponse> Create(Guid companyId, CreateAccountRequest request)
    {
        return StatusCode(StatusCodes.Status201Created, new AccountResponse(
            Guid.NewGuid(), request.Code, request.Name, request.AccountType, request.AccountSubType,
            request.ParentAccountId, request.IsReconcilable, DateTime.UtcNow, request.NameSq,
            request.Class, request.Group, request.Statement, request.NormalBalance, request.Subledger,
            request.IsControl, request.IsPostable, request.DefaultVatCode, request.CitDeductibility,
            request.CitLimitRule, request.Profiles, true, request.ValidFrom, request.ValidTo));
    }

    // CONTRACT STUB — replaced in B1
    [HttpPut("{accountId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public ActionResult<AccountResponse> Update(Guid companyId, Guid accountId, UpdateAccountRequest request)
    {
        return Ok(new AccountResponse(
            accountId, request.Code, request.Name, request.AccountType, request.AccountSubType,
            request.ParentAccountId, request.IsReconcilable, DateTime.UtcNow, request.NameSq,
            request.Class, request.Group, request.Statement, request.NormalBalance, request.Subledger,
            request.IsControl, request.IsPostable, request.DefaultVatCode, request.CitDeductibility,
            request.CitLimitRule, request.Profiles, true, request.ValidFrom, request.ValidTo));
    }

    // CONTRACT STUB — replaced in B1
    [HttpPost("{accountId:guid}/deactivate")]
    [RequireCompanyAccess(writeAccess: true)]
    public ActionResult<AccountResponse> Deactivate(Guid companyId, Guid accountId)
    {
        return Ok(new AccountResponse(
            accountId, "110100", "Cash", AccountType.Asset, AccountSubType.Cash,
            null, false, DateTime.UtcNow, "Arka", 1, 1, AccountStatement.BalanceSheet, Domain.Ledger.NormalBalance.Debit,
            SubledgerType.Cash, false, true, null, CitDeductibility.Na, null, Domain.Companies.CompanyProfile.Core,
            false, null, null));
    }

    private static AccountResponse ToResponse(Account a) => new(
        a.Id, a.Code, a.Name, a.AccountType, a.AccountSubType, a.ParentAccountId, a.IsReconcilable,
        a.CreatedAt, a.NameSq, a.Class, a.Group, a.Statement, a.NormalBalance, a.Subledger,
        a.IsControl, a.IsPostable, a.DefaultVatCode, a.CitDeductibility, a.CitLimitRule, a.Profiles,
        a.IsActive, a.ValidFrom, a.ValidTo);
}
