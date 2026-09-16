using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection.
public class PartnersControllerTests : IAsyncLifetime
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

    private static PartnersController NewController(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>());

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid AccountId)> SeedCompanyWithAccountAsync()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        var account = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "110900", Name = "Receivables - Related Parties", AccountType = AccountType.Receivable };
        db.Accounts.Add(account);
        await db.SaveChangesAsync();
        return (db, company.Id, account.Id);
    }

    [Fact]
    public async Task Create_Succeeds_WithSubledgerFields()
    {
        var (db, companyId, accountId) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreatePartnerRequest(
            "Acme LLC", "810123456", IsCustomer: true, IsVendor: false,
            ReceivableAccountId: accountId, PaymentTermDays: 30, CreditLimit: 5000m));

        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(accountId, created.ReceivableAccountId);
        Assert.Equal(30, created.PaymentTermDays);
        Assert.Equal(5000m, created.CreditLimit);
    }

    [Fact]
    public async Task Create_MissingName_Rejected()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreatePartnerRequest("  ", null, true, false));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ControlAccountNotBelongingToCompany_Rejected()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreatePartnerRequest(
            "Acme LLC", null, true, false, ReceivableAccountId: Guid.NewGuid()));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_ChangesSubledgerFields()
    {
        var (db, companyId, accountId) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);
        var createResult = await controller.Create(companyId, new CreatePartnerRequest("Acme LLC", null, true, false));
        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var updateResult = await controller.Update(companyId, created.Id, new UpdatePartnerRequest(
            "Acme LLC", "810123456", true, false,
            ReceivableAccountId: accountId, PaymentTermDays: 45, CreditLimit: 10000m));

        var updated = Assert.IsType<PartnerResponse>(Assert.IsType<OkObjectResult>(updateResult.Result).Value);
        Assert.Equal(accountId, updated.ReceivableAccountId);
        Assert.Equal(45, updated.PaymentTermDays);
        Assert.Equal(10000m, updated.CreditLimit);
    }

    [Fact]
    public async Task Update_UnknownPartner_ReturnsNotFound()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var result = await controller.Update(companyId, Guid.NewGuid(), new UpdatePartnerRequest("X", null, true, false));

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Get_ReturnsPartner()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);
        var createResult = await controller.Create(companyId, new CreatePartnerRequest("Acme LLC", null, true, false));
        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var result = await controller.Get(companyId, created.Id);

        var fetched = Assert.IsType<PartnerResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(created.Id, fetched.Id);
    }
}
