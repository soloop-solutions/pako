using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection —
// without it, connections pile up across the run and Postgres refuses new ones past max_connections.
public class AccountsControllerTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private async Task<PakoDbContext> NewContextAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        return db;
    }

    private static AccountsController NewController(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>());

    private async Task<(PakoDbContext Db, Guid CompanyId)> SeedCompanyAsync()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return (db, company.Id);
    }

    // ck_accounts_code_class_group: first digit of Code must equal Class, first two digits must
    // equal Group (zero-padded) — "6000" / Class 6 / Group 60 satisfies both.
    private static CreateAccountRequest CreateRequest(string code = "6000", string name = "Marketing Expense") =>
        new(code, name, AccountType.Expense, AccountSubType.None, null, false,
            "Shpenzime Marketingu", 6, 60, AccountStatement.IncomeStatement, NormalBalance.Debit, SubledgerType.None,
            false, true, null, CitDeductibility.Full, null, CompanyProfile.Core, null, null);

    private static UpdateAccountRequest UpdateRequest(string code, string name = "Marketing Expense (Updated)") =>
        new(code, name, AccountType.Expense, AccountSubType.None, null, true,
            "Shpenzime Marketingu (Përditësuar)", 6, 60, AccountStatement.IncomeStatement, NormalBalance.Debit, SubledgerType.None,
            false, true, "S18", CitDeductibility.Full, null, CompanyProfile.Core, null, null);

    [Fact]
    public async Task Create_Succeeds_AndAppearsInList()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var createResult = await controller.Create(companyId, CreateRequest());
        var created = Assert.IsType<AccountResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        Assert.Equal("6000", created.Code);
        Assert.Equal("Marketing Expense", created.Name);
        Assert.True(created.IsActive);
        Assert.Equal(CompanyProfile.Core, created.Profiles);

        var listResult = await controller.List(companyId);
        var accounts = Assert.IsType<List<AccountResponse>>(Assert.IsType<OkObjectResult>(listResult.Result).Value);
        Assert.Contains(accounts, a => a.Id == created.Id);
    }

    [Fact]
    public async Task Create_MissingCode_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, CreateRequest(code: "   "));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_MissingName_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, CreateRequest(name: " "));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_DuplicateCodeInSameCompany_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        await controller.Create(companyId, CreateRequest());

        var result = await controller.Create(companyId, CreateRequest());

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_SameCodeInDifferentCompany_Succeeds()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var otherCompany = new Company { Id = Guid.NewGuid(), Name = "Other Co" };
        db.Companies.Add(otherCompany);
        await db.SaveChangesAsync();
        var controller = NewController(db);
        await controller.Create(companyId, CreateRequest());

        var result = await controller.Create(otherCompany.Id, CreateRequest());

        Assert.IsType<ObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_ChangesFields_Succeeds()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var createResult = await controller.Create(companyId, CreateRequest());
        var created = Assert.IsType<AccountResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var updateResult = await controller.Update(companyId, created.Id, UpdateRequest(created.Code));

        var updated = Assert.IsType<AccountResponse>(Assert.IsType<OkObjectResult>(updateResult.Result).Value);
        Assert.Equal("Marketing Expense (Updated)", updated.Name);
        Assert.True(updated.IsReconcilable);
        Assert.Equal("S18", updated.DefaultVatCode);
    }

    // R25: an account's code is immutable once created.
    [Fact]
    public async Task Update_AttemptingToChangeCode_Rejected_R25()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var createResult = await controller.Create(companyId, CreateRequest());
        var created = Assert.IsType<AccountResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var updateResult = await controller.Update(companyId, created.Id, UpdateRequest("6999"));

        Assert.IsType<BadRequestObjectResult>(updateResult.Result);
        var reloaded = await db.Accounts.FindAsync(created.Id);
        Assert.Equal("6000", reloaded!.Code);
    }

    [Fact]
    public async Task Update_NonexistentAccount_ReturnsNotFound()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Update(companyId, Guid.NewGuid(), UpdateRequest("6000"));

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Deactivate_SetsIsActiveFalse()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var createResult = await controller.Create(companyId, CreateRequest());
        var created = Assert.IsType<AccountResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var deactivateResult = await controller.Deactivate(companyId, created.Id);

        var deactivated = Assert.IsType<AccountResponse>(Assert.IsType<OkObjectResult>(deactivateResult.Result).Value);
        Assert.False(deactivated.IsActive);
    }

    [Fact]
    public async Task Deactivate_AlreadyInactive_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var createResult = await controller.Create(companyId, CreateRequest());
        var created = Assert.IsType<AccountResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);
        await controller.Deactivate(companyId, created.Id);

        var result = await controller.Deactivate(companyId, created.Id);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Deactivate_NonexistentAccount_ReturnsNotFound()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Deactivate(companyId, Guid.NewGuid());

        Assert.IsType<NotFoundResult>(result.Result);
    }
}
