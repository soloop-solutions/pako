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

public class PaymentMethodsControllerTests
{
    private static PaymentMethodsController NewController(PakoDbContext db)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));

        return new PaymentMethodsController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    private static async Task<(PakoDbContext Db, Guid CompanyId, Guid CashAccountId, Guid BankAccountId, Guid RevenueAccountId)> SeedAsync()
    {
        var db = new PakoDbContext(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var cashAccountId = Guid.NewGuid();
        var bankAccountId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Accounts.Add(new Account { Id = cashAccountId, CompanyId = company.Id, Code = "100100", Name = "Cash", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = bankAccountId, CompanyId = company.Id, Code = "101001", Name = "Bank", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Bank });
        db.Accounts.Add(new Account { Id = revenueAccountId, CompanyId = company.Id, Code = "400100", Name = "Revenue", AccountType = AccountType.Income });
        await db.SaveChangesAsync();

        return (db, company.Id, cashAccountId, bankAccountId, revenueAccountId);
    }

    [Fact]
    public async Task Create_RejectsBlankName()
    {
        var (db, companyId, cashAccountId, _, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreatePaymentMethodRequest("  ", PaymentMethodKind.Cash, cashAccountId));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_RejectsAccountThatIsNotCashOrBank()
    {
        var (db, companyId, _, _, revenueAccountId) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreatePaymentMethodRequest("Revenue", PaymentMethodKind.Cash, revenueAccountId));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_RejectsAccountFromAnotherCompany()
    {
        var (db, companyId, _, _, _) = await SeedAsync();
        var otherCompanyAccountId = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = otherCompanyAccountId, CompanyId = Guid.NewGuid(), Code = "100100", Name = "Other Cash", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Cash });
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreatePaymentMethodRequest("Cash", PaymentMethodKind.Cash, otherCompanyAccountId));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ThenList_ReturnsItOrderedByKindThenName()
    {
        var (db, companyId, cashAccountId, bankAccountId, _) = await SeedAsync();
        var controller = NewController(db);

        var bankResult = await controller.Create(companyId, new CreatePaymentMethodRequest("ProCredit", PaymentMethodKind.Bank, bankAccountId));
        var cashResult = await controller.Create(companyId, new CreatePaymentMethodRequest("Main till", PaymentMethodKind.Cash, cashAccountId));

        Assert.Equal(StatusCodes.Status201Created, ((ObjectResult)bankResult.Result!).StatusCode);
        Assert.Equal(StatusCodes.Status201Created, ((ObjectResult)cashResult.Result!).StatusCode);

        var listResult = await controller.List(companyId);
        var okResult = Assert.IsType<OkObjectResult>(listResult.Result);
        var methods = Assert.IsType<List<PaymentMethodResponse>>(okResult.Value);

        Assert.Equal(2, methods.Count);
        Assert.Equal(PaymentMethodKind.Cash, methods[0].Kind);
        Assert.Equal(PaymentMethodKind.Bank, methods[1].Kind);
    }
}
