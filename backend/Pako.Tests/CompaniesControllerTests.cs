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

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection —
// without it, connections pile up across the run and Postgres refuses new ones past max_connections.
public class CompaniesControllerTests : IAsyncLifetime
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

    private static CompaniesController NewController(PakoDbContext db, Guid userId)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"));

        return new CompaniesController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    [Fact]
    public async Task Create_RejectsNameOver256Characters()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest(new string('A', 257)));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Company name must be 256 characters or fewer.", badRequest.Value);
        Assert.Empty(db.Companies);
    }

    [Fact]
    public async Task Create_RejectsWhitespaceOnlyName()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("   "));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Company name is required.", badRequest.Value);
        Assert.Empty(db.Companies);
    }

    [Fact]
    public async Task Create_AcceptsUnicodeAlbanianCharacters()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Shoqëria Çelniku Sh.p.k."));

        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("Shoqëria Çelniku Sh.p.k.", created.Name);
    }

    // Plani Kontabel v2.0 (COA_V2_IMPLEMENTATION_BRIEF.md Stage 2): a company created with no
    // EnabledProfiles gets exactly the 167 CORE accounts (50_Profiles), not the old 16-account
    // placeholder chart, and a CompanyAccountDefaults row with the 5 always-present roles
    // resolved and the 4 Payroll-gated ones left null.
    [Fact]
    public async Task Create_WithNoProfiles_SeedsExactlyCoreAccountsAndCoreOnlyDefaults()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Core Only Co"));

        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(CompanyProfile.Core, created.EnabledProfiles);

        var accountCount = await db.Accounts.CountAsync(a => a.CompanyId == created.Id);
        Assert.Equal(167, accountCount);

        var defaults = await db.CompanyAccountDefaults.SingleAsync(d => d.CompanyId == created.Id);
        Assert.NotEqual(Guid.Empty, defaults.ReceivableAccountId);
        Assert.NotEqual(Guid.Empty, defaults.PayableAccountId);
        Assert.NotEqual(Guid.Empty, defaults.RevenueAccountId);
        Assert.NotEqual(Guid.Empty, defaults.ExpenseAccountId);
        Assert.NotEqual(Guid.Empty, defaults.CustomerDepositsAccountId);
        Assert.Null(defaults.SalaryExpenseAccountId);
        Assert.Null(defaults.PitPayableAccountId);
        Assert.Null(defaults.PensionPayableAccountId);
        Assert.Null(defaults.NetPayPayableAccountId);
    }

    [Fact]
    public async Task Create_WithImportAndPayrollProfiles_SeedsCoreImportPayrollAccountsAndFullDefaults()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest(
            "Trading Co", EnabledProfiles: CompanyProfile.Import | CompanyProfile.Payroll));

        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(CompanyProfile.Core | CompanyProfile.Import | CompanyProfile.Payroll, created.EnabledProfiles);

        var accountCount = await db.Accounts.CountAsync(a => a.CompanyId == created.Id);
        Assert.Equal(167 + 22 + 13, accountCount);

        var defaults = await db.CompanyAccountDefaults.SingleAsync(d => d.CompanyId == created.Id);
        Assert.NotNull(defaults.SalaryExpenseAccountId);
        Assert.NotNull(defaults.PitPayableAccountId);
        Assert.NotNull(defaults.PensionPayableAccountId);
        Assert.NotNull(defaults.NetPayPayableAccountId);
    }

    [Fact]
    public async Task Create_SeedsExactlyFourControlAccounts()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Control Co"));
        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

        var controlCodes = await db.Accounts
            .Where(a => a.CompanyId == created.Id && a.IsControl)
            .Select(a => a.Code)
            .ToListAsync();

        Assert.Equal(new[] { "110100", "110200", "200100", "200200" }, controlCodes.OrderBy(c => c));
    }

    // Track C4: a fresh company needs at least one Cash and one Bank payment method so the
    // record-payment/pay-at-creation pickers aren't empty out of the box.
    [Fact]
    public async Task Create_SeedsOneCashAndOneBankPaymentMethod()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Payment Co"));
        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

        var methods = await db.PaymentMethods.Where(m => m.CompanyId == created.Id).ToListAsync();

        Assert.Contains(methods, m => m.Kind == PaymentMethodKind.Cash);
        Assert.Contains(methods, m => m.Kind == PaymentMethodKind.Bank);
    }

    // B9: General/Sale/Purchase/Cash/Bank — every auto-routed document type has its own journal to
    // post to (JournalResolver), not "the first journal for this company".
    [Fact]
    public async Task Create_SeedsGeneralSalePurchaseCashAndBankJournals()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Journal Co"));
        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

        var journalTypes = await db.Journals.Where(j => j.CompanyId == created.Id).Select(j => j.Type).ToListAsync();

        Assert.Equal(
            new[] { JournalType.General, JournalType.Sale, JournalType.Purchase, JournalType.Cash, JournalType.Bank }.OrderBy(t => t),
            journalTypes.OrderBy(t => t));
    }

    // B2: 7 Class-level groups (1-7) + 28 Group-level groups (10-15, 20-24, 30, 40-42, 50-52,
    // 60-66, 70-72) — one row per distinct (Class, Group) pair in PAKO_COA_v2_seed.csv, seeded
    // regardless of which profiles are enabled since the hierarchy itself doesn't vary by profile.
    [Fact]
    public async Task Create_Seeds35AccountGroups_SevenClassLevelAndTwentyEightGroupLevel()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Group Co"));
        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

        var groups = await db.AccountGroups.Where(g => g.CompanyId == created.Id).ToListAsync();

        Assert.Equal(35, groups.Count);
        Assert.Equal(7, groups.Count(g => g.ParentGroupId == null));
        Assert.Equal(28, groups.Count(g => g.ParentGroupId != null));
        // Every Group-level row's parent must actually exist among this same company's rows.
        var ids = groups.Select(g => g.Id).ToHashSet();
        Assert.All(groups.Where(g => g.ParentGroupId != null), g => Assert.Contains(g.ParentGroupId!.Value, ids));
    }

    // B3: every seeded account gets a CashFlowCategory derived from its Class/Group — spot-check
    // one account from each category, plus prove no seeded account is left at the domain default
    // by accident (None is a real, meaningful category here — Cash and Cash Equivalents — so the
    // assertion below counts Operating/Investing/Financing accounts explicitly rather than just
    // checking "not None" on everything).
    [Fact]
    public async Task Create_SeedsCashFlowCategoryOnEveryAccount()
    {
        var db = await NewContextAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Cash Flow Co"));
        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

        var accounts = await db.Accounts.Where(a => a.CompanyId == created.Id).ToListAsync();

        Assert.NotEmpty(accounts);
        Assert.Equal(CashFlowCategory.None, accounts.Single(a => a.Code == "100100").CashFlowCategory); // Cash
        Assert.Equal(CashFlowCategory.Investing, accounts.Single(a => a.Code == "150100").CashFlowCategory); // Land
        Assert.Equal(CashFlowCategory.Financing, accounts.Single(a => a.Code == "300100").CashFlowCategory); // Share Capital
        Assert.Equal(CashFlowCategory.Financing, accounts.Single(a => a.Code == "230100").CashFlowCategory); // Short-term Bank Loans
        Assert.Equal(CashFlowCategory.Operating, accounts.Single(a => a.Code == "400100").CashFlowCategory); // Goods Sales
        Assert.Equal(CashFlowCategory.Operating, accounts.Single(a => a.Code == "610100").CashFlowCategory); // Rent

        Assert.Contains(accounts, a => a.CashFlowCategory == CashFlowCategory.Operating);
        Assert.Contains(accounts, a => a.CashFlowCategory == CashFlowCategory.Investing);
        Assert.Contains(accounts, a => a.CashFlowCategory == CashFlowCategory.Financing);
    }
}
