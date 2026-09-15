using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
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
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public AccountsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<AccountResponse>>> List(Guid companyId)
    {
        var accounts = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .OrderBy(a => a.Code)
            .ToListAsync();
        var groups = await GetGroupsAsync(companyId);

        return Ok(accounts.Select(a => ToResponse(a, groups)).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(AccountResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<AccountResponse>> Create(Guid companyId, CreateAccountRequest request)
    {
        var code = request.Code?.Trim() ?? string.Empty;
        var name = request.Name?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(_localizer["AccountCodeRequired"].Value);
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            return BadRequest(_localizer["AccountNameRequired"].Value);
        }

        var codeTaken = await _db.Accounts.AsNoTracking()
            .AnyAsync(a => a.CompanyId == companyId && a.Code == code);
        if (codeTaken)
        {
            return BadRequest(_localizer["AccountCodeAlreadyExists"].Value);
        }

        var account = new Account
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Code = code,
            Name = name,
            AccountType = request.AccountType,
            AccountSubType = request.AccountSubType,
            ParentAccountId = request.ParentAccountId,
            IsReconcilable = request.IsReconcilable,
            NameSq = request.NameSq,
            Class = request.Class,
            Group = request.Group,
            Statement = request.Statement,
            NormalBalance = request.NormalBalance,
            Subledger = request.Subledger,
            IsControl = request.IsControl,
            IsPostable = request.IsPostable,
            DefaultVatCode = request.DefaultVatCode,
            CitDeductibility = request.CitDeductibility,
            CitLimitRule = request.CitLimitRule,
            Profiles = request.Profiles,
            ValidFrom = request.ValidFrom,
            ValidTo = request.ValidTo,
            // B3: derived from Class/Group like the seed does, not a raw request field — a
            // client that doesn't set Class (free-text/manual accounts) gets None, same as the
            // domain default.
            CashFlowCategory = request.Class is int accountClass
                ? AccountTypeDerivation.DeriveCashFlowCategory(accountClass, request.Group)
                : Domain.Ledger.CashFlowCategory.None
        };

        _db.Accounts.Add(account);
        await _db.SaveChangesAsync();

        var groups = await GetGroupsAsync(companyId);
        return StatusCode(StatusCodes.Status201Created, ToResponse(account, groups));
    }

    [HttpPut("{accountId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<AccountResponse>> Update(Guid companyId, Guid accountId, UpdateAccountRequest request)
    {
        var account = await _db.Accounts.FirstOrDefaultAsync(a => a.Id == accountId && a.CompanyId == companyId);
        if (account == null) return NotFound();

        var name = request.Name?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(name))
        {
            return BadRequest(_localizer["AccountNameRequired"].Value);
        }

        // R25: the code is immutable once the account exists — renumbering goes through a
        // versioned mapping (90_Migration), never an in-place edit.
        var requestedCode = request.Code?.Trim() ?? string.Empty;
        if (requestedCode != account.Code)
        {
            return BadRequest(_localizer["AccountCodeCannotBeChanged"].Value);
        }

        account.Name = name;
        account.AccountType = request.AccountType;
        account.AccountSubType = request.AccountSubType;
        account.ParentAccountId = request.ParentAccountId;
        account.IsReconcilable = request.IsReconcilable;
        account.NameSq = request.NameSq;
        account.Class = request.Class;
        account.Group = request.Group;
        account.Statement = request.Statement;
        account.NormalBalance = request.NormalBalance;
        account.Subledger = request.Subledger;
        account.IsControl = request.IsControl;
        account.IsPostable = request.IsPostable;
        account.DefaultVatCode = request.DefaultVatCode;
        account.CitDeductibility = request.CitDeductibility;
        account.CitLimitRule = request.CitLimitRule;
        account.Profiles = request.Profiles;
        account.ValidFrom = request.ValidFrom;
        account.ValidTo = request.ValidTo;
        account.CashFlowCategory = request.Class is int accountClass
            ? AccountTypeDerivation.DeriveCashFlowCategory(accountClass, request.Group)
            : Domain.Ledger.CashFlowCategory.None;

        await _db.SaveChangesAsync();
        var groups = await GetGroupsAsync(companyId);
        return Ok(ToResponse(account, groups));
    }

    // R26: accounts are deactivated, never deleted — there is deliberately no DELETE action on
    // this controller at all (see NoDeletionGuaranteeTests.AccountsController_HasNoDeleteRoute).
    [HttpPost("{accountId:guid}/deactivate")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<AccountResponse>> Deactivate(Guid companyId, Guid accountId)
    {
        var account = await _db.Accounts.FirstOrDefaultAsync(a => a.Id == accountId && a.CompanyId == companyId);
        if (account == null) return NotFound();

        if (!account.IsActive)
        {
            return BadRequest(_localizer["AccountAlreadyInactive"].Value);
        }

        account.IsActive = false;
        await _db.SaveChangesAsync();

        var groups = await GetGroupsAsync(companyId);
        return Ok(ToResponse(account, groups));
    }

    private async Task<List<AccountGroup>> GetGroupsAsync(Guid companyId) =>
        await _db.AccountGroups.AsNoTracking().Where(g => g.CompanyId == companyId).ToListAsync();

    private static AccountResponse ToResponse(Account a, IReadOnlyCollection<AccountGroup> groups) => new(
        a.Id, a.Code, a.Name, a.AccountType, a.AccountSubType, a.ParentAccountId, a.IsReconcilable,
        a.CreatedAt, a.NameSq, a.Class, a.Group, a.Statement, a.NormalBalance, a.Subledger,
        a.IsControl, a.IsPostable, a.DefaultVatCode, a.CitDeductibility, a.CitLimitRule, a.Profiles,
        a.IsActive, a.ValidFrom, a.ValidTo, AccountGroupResolver.Resolve(a.Code, groups)?.Id, a.CashFlowCategory);
}
