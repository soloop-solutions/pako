using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;
using Pako.Localization.Xk;

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

    // B2: group membership is computed from Code against the company's AccountGroup prefix
    // ranges — deliberately NOT from Account.Class/Account.Group (those are the raw source-CSV
    // columns, kept for reference; a manually-created account here leaves both null on purpose,
    // to prove the resolver never reads them).
    [Fact]
    public async Task Create_NewAccountInARange_ResolvesGroupWithNoExtraInput()
    {
        var (db, companyId) = await SeedCompanyAsync();
        db.AccountGroups.AddRange(AccountGroupTemplate.BuildForCompany(companyId));
        await db.SaveChangesAsync();
        var controller = NewController(db);

        // 651000 falls inside Group 65 (Depreciation & Amortization, 650000-659999) — Class/Group
        // are left null on the request itself.
        var request = new CreateAccountRequest(
            "651000", "Equipment Depreciation", AccountType.Expense, AccountSubType.None, null, false,
            null, null, null, null, null, null, false, true, null, null, null, CompanyProfile.Core, null, null);

        var result = await controller.Create(companyId, request);

        var created = Assert.IsType<AccountResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.NotNull(created.GroupId);

        var expectedGroup = await db.AccountGroups.SingleAsync(g => g.CompanyId == companyId && g.Name == "Depreciation & Amortization");
        Assert.Equal(expectedGroup.Id, created.GroupId);
    }

    // Full end-to-end through CompaniesController.Create (real 233-row v2 chart + 35 groups),
    // not the lightweight SeedCompanyAsync() this file otherwise uses — this is the one place
    // that actually exercises "every seeded account resolves a group with no backfill."
    [Fact]
    public async Task List_EveryChartAccount_HasAComputedGroup_WithNoBackfill()
    {
        var db = await NewContextAsync();
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));
        var companiesController = new CompaniesController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
        var companyResult = await companiesController.Create(new CreateCompanyRequest("Full Chart Co"));
        var company = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(companyResult.Result).Value);

        var accountsController = NewController(db);
        var listResult = await accountsController.List(company.Id);
        var accounts = Assert.IsType<List<AccountResponse>>(Assert.IsType<OkObjectResult>(listResult.Result).Value);

        Assert.NotEmpty(accounts);
        Assert.All(accounts, a => Assert.NotNull(a.GroupId));

        var cash = Assert.Single(accounts, a => a.Code == "100100");
        var incomeTax = Assert.Single(accounts, a => a.Code == "720100");

        var groups = await db.AccountGroups.Where(g => g.CompanyId == company.Id).ToDictionaryAsync(g => g.Id);
        Assert.Equal("Cash and Cash Equivalents", groups[cash.GroupId!.Value].Name);
        Assert.Equal("Income Tax", groups[incomeTax.GroupId!.Value].Name);
    }

    // B3: CashFlowCategory round-trips through Create — CreateRequest() defaults to Class 6/
    // Group 60 (Personnel-range opex), which derives to Operating.
    [Fact]
    public async Task Create_DerivesCashFlowCategoryFromClassAndGroup()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, CreateRequest());

        var created = Assert.IsType<AccountResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(CashFlowCategory.Operating, created.CashFlowCategory);
    }
}
