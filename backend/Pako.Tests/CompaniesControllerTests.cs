using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Tests;

public class CompaniesControllerTests
{
    private static PakoDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PakoDbContext(options);
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
        var db = NewContext();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest(new string('A', 257)));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Company name must be 256 characters or fewer.", badRequest.Value);
        Assert.Empty(db.Companies);
    }

    [Fact]
    public async Task Create_RejectsWhitespaceOnlyName()
    {
        var db = NewContext();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("   "));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Company name is required.", badRequest.Value);
        Assert.Empty(db.Companies);
    }

    [Fact]
    public async Task Create_AcceptsUnicodeAlbanianCharacters()
    {
        var db = NewContext();
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
        var db = NewContext();
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
        var db = NewContext();
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
        var db = NewContext();
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
        var db = NewContext();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Payment Co"));
        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

        var methods = await db.PaymentMethods.Where(m => m.CompanyId == created.Id).ToListAsync();

        Assert.Contains(methods, m => m.Kind == PaymentMethodKind.Cash);
        Assert.Contains(methods, m => m.Kind == PaymentMethodKind.Bank);
    }
}
