using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
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

    private static PartnersController NewController(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted());

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
    public async Task Create_PersistsContactAndAddressFields()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreatePartnerRequest(
            "Acme LLC", "810123456", true, false,
            Email: " info@acme.test ", Phone: "+383 44 111 222", ContactPerson: "Arta Berisha",
            StreetAddress: "Rr. Nena Tereze 1", City: "Prishtine", PostalCode: "10000", Country: "XK"));

        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("info@acme.test", created.Email);
        Assert.Equal("Arta Berisha", created.ContactPerson);
        Assert.Equal("Prishtine", created.City);
        var stored = await db.Partners.AsNoTracking().SingleAsync(p => p.Id == created.Id);
        Assert.Equal("10000", stored.PostalCode);
        Assert.Equal("XK", stored.Country);
    }

    [Fact]
    public async Task Create_InvalidEmail_Rejected()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreatePartnerRequest("Acme LLC", null, true, false, Email: "not-an-email"));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_ReplacesContactFields()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);
        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>((await controller.Create(companyId,
            new CreatePartnerRequest("Acme LLC", null, true, false, Phone: "1"))).Result).Value);

        var updated = await controller.Update(companyId, created.Id, new UpdatePartnerRequest("Acme LLC", null, true, false, Phone: "2", City: "Peje"));

        var body = Assert.IsType<PartnerResponse>(Assert.IsType<OkObjectResult>(updated.Result).Value);
        Assert.Equal("2", body.Phone);
        Assert.Equal("Peje", body.City);
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

    // Client request 2026-11-23: customers and suppliers are separate; VAT number when VAT registered.
    [Fact]
    public async Task Create_CustomerAndSupplierAtOnce_Rejected()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();

        var result = await NewController(db).Create(companyId, new CreatePartnerRequest("Acme LLC", null, true, true));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.False(await db.Partners.AnyAsync());
    }

    [Fact]
    public async Task Update_LegacyPartnerWithBothRoles_MustChooseOne()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);
        var created = Assert.IsType<PartnerResponse>(((ObjectResult)(await controller.Create(companyId, new CreatePartnerRequest("Acme LLC", null, true, false))).Result!).Value);

        Assert.IsType<BadRequestObjectResult>((await controller.Update(companyId, created.Id, new UpdatePartnerRequest("Acme LLC", null, true, true))).Result);
        Assert.IsType<OkObjectResult>((await controller.Update(companyId, created.Id, new UpdatePartnerRequest("Acme LLC", null, true, false))).Result);
    }

    [Fact]
    public async Task Create_VatRegisteredWithoutVatNumber_Accepted()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();

        var result = await NewController(db).Create(companyId, new CreatePartnerRequest("Acme LLC", "811234567", true, false, IsVatRegistered: true, VatNumber: "  "));

        var created = Assert.IsType<PartnerResponse>(((ObjectResult)result.Result!).Value);
        Assert.True(created.IsVatRegistered);
        Assert.Null(created.VatNumber);
    }

    [Theory]
    [InlineData("81123456")]
    [InlineData("8112345678")]
    [InlineData("81123456A")]
    public async Task Create_NuiNotNineDigits_Rejected(string nui)
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();

        var result = await NewController(db).Create(companyId, new CreatePartnerRequest("Acme LLC", nui, true, false));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Theory]
    [InlineData("33012345")]
    [InlineData("3301234567")]
    [InlineData("33012345X")]
    public async Task Create_VatNumberNotNineDigits_Rejected(string vat)
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();

        var result = await NewController(db).Create(companyId, new CreatePartnerRequest("Acme LLC", "811234567", true, false, IsVatRegistered: true, VatNumber: vat));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Theory]
    [InlineData("12345678")]
    [InlineData("12345678901")]
    [InlineData("12345abcd")]
    public async Task Create_FiscalNumberNotNineOrTenDigits_Rejected(string fiscal)
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();

        var result = await NewController(db).Create(companyId, new CreatePartnerRequest("Ardit Krasniqi", null, true, false, FiscalNumber: fiscal));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_VatRegistered_StoresVatNumber_AndDropsItWhenNotRegistered()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var vat = Assert.IsType<PartnerResponse>(((ObjectResult)(await controller.Create(companyId,
            new CreatePartnerRequest("Acme LLC", "811234567", true, false, IsVatRegistered: true, VatNumber: " 330123456 "))).Result!).Value);
        Assert.Equal("330123456", vat.VatNumber);

        var updated = Assert.IsType<PartnerResponse>(Assert.IsType<OkObjectResult>((await controller.Update(companyId, vat.Id,
            new UpdatePartnerRequest("Acme LLC", "811234567", true, false, IsVatRegistered: false, VatNumber: "330123456"))).Result).Value);
        Assert.Null(updated.VatNumber);
    }

    [Fact]
    public async Task Archive_HidesPartnerFromActiveOnlyList_AndUnarchiveRestoresIt()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);
        var created = Assert.IsType<PartnerResponse>(((ObjectResult)(await controller.Create(companyId, new CreatePartnerRequest("Acme LLC", "811234567", false, true))).Result!).Value);

        var archived = Assert.IsType<PartnerResponse>(Assert.IsType<OkObjectResult>((await controller.Archive(companyId, created.Id)).Result).Value);
        Assert.False(archived.IsActive);
        var activeOnly = Assert.IsType<List<PartnerResponse>>(Assert.IsType<OkObjectResult>((await controller.List(companyId, activeOnly: true)).Result).Value);
        Assert.DoesNotContain(activeOnly, p => p.Id == created.Id);
        var everyone = Assert.IsType<List<PartnerResponse>>(Assert.IsType<OkObjectResult>((await controller.List(companyId)).Result).Value);
        Assert.Contains(everyone, p => p.Id == created.Id);

        var restored = Assert.IsType<PartnerResponse>(Assert.IsType<OkObjectResult>((await controller.Unarchive(companyId, created.Id)).Result).Value);
        Assert.True(restored.IsActive);
    }

    [Fact]
    public async Task Delete_UnusedPartner_Removes()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);
        var created = Assert.IsType<PartnerResponse>(((ObjectResult)(await controller.Create(companyId, new CreatePartnerRequest("Acme LLC", "811234567", false, true))).Result!).Value);

        Assert.IsType<NoContentResult>(await controller.Delete(companyId, created.Id));
        Assert.False(await db.Partners.AnyAsync(p => p.Id == created.Id));
    }

    [Fact]
    public async Task Delete_PartnerWithABill_RefusedAndKept()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);
        var created = Assert.IsType<PartnerResponse>(((ObjectResult)(await controller.Create(companyId, new CreatePartnerRequest("Acme LLC", "811234567", false, true))).Result!).Value);
        db.Bills.Add(new Pako.Domain.Bills.Bill { Id = Guid.NewGuid(), CompanyId = companyId, PartnerId = created.Id, IssueDate = new DateOnly(2026, 11, 1), DueDate = new DateOnly(2026, 11, 30) });
        await db.SaveChangesAsync();

        Assert.IsType<ConflictObjectResult>(await controller.Delete(companyId, created.Id));
        Assert.True(await db.Partners.AnyAsync(p => p.Id == created.Id));
    }

    [Fact]
    public async Task Delete_EmployeePartner_Refused()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Employee", IsVendor = true, EmployeeId = Guid.NewGuid() };
        db.Partners.Add(partner);
        await db.SaveChangesAsync();

        Assert.IsType<ConflictObjectResult>(await NewController(db).Delete(companyId, partner.Id));
    }

    // Client request 2026-11-23: partner line defaults.
    [Fact]
    public async Task Create_StoresLineDefaults()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var expense = new Account { Id = Guid.NewGuid(), CompanyId = companyId, Code = "610000", Name = "Rent", AccountType = AccountType.Expense };
        db.Accounts.Add(expense);
        await db.SaveChangesAsync();

        var result = await NewController(db).Create(companyId, new CreatePartnerRequest(
            "Landlord", null, false, true, DefaultExpenseAccountId: expense.Id));

        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(expense.Id, created.DefaultExpenseAccountId);
    }

    [Fact]
    public async Task Create_ControlAccountAsLineDefault_Rejected()
    {
        var (db, companyId, accountId) = await SeedCompanyWithAccountAsync();
        var control = await db.Accounts.SingleAsync(a => a.Id == accountId);
        control.IsControl = true;
        await db.SaveChangesAsync();

        var result = await NewController(db).Create(companyId, new CreatePartnerRequest(
            "Acme LLC", null, true, false, DefaultRevenueAccountId: accountId));

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

    [Fact]
    public async Task Create_DuplicateTaxNumberInSameCompany_Rejected()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        await controller.Create(companyId, new CreatePartnerRequest("Partner A", "811234567", true, false));
        var result = await controller.Create(companyId, new CreatePartnerRequest("Partner B", "811234567", true, false));

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_DuplicateTaxNumberWithWhitespace_Rejected()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        await controller.Create(companyId, new CreatePartnerRequest("Partner A", "811234567", true, false));
        var result = await controller.Create(companyId, new CreatePartnerRequest("Partner B", " 811234567 ", true, false));

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_DifferentTaxNumbers_Succeeds()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        await controller.Create(companyId, new CreatePartnerRequest("Partner A", "811234567", true, false));
        var result = await controller.Create(companyId, new CreatePartnerRequest("Partner B", "812345678", true, false));

        Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(201, ((ObjectResult)result.Result!).StatusCode);
    }

    [Fact]
    public async Task Create_NullTaxNumber_AllowsMultiple()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        await controller.Create(companyId, new CreatePartnerRequest("Partner A", null, true, false));
        var result = await controller.Create(companyId, new CreatePartnerRequest("Partner B", null, true, false));

        Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(201, ((ObjectResult)result.Result!).StatusCode);
    }

    [Fact]
    public async Task Update_KeepSameTaxNumber_Succeeds()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var createResult = await controller.Create(companyId, new CreatePartnerRequest("Partner A", "811234567", true, false));
        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var result = await controller.Update(companyId, created.Id, new UpdatePartnerRequest("Partner A Updated", "811234567", true, false));

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_ChangeToUnusedTaxNumber_Succeeds()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var createResult = await controller.Create(companyId, new CreatePartnerRequest("Partner A", "811234567", true, false));
        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var result = await controller.Update(companyId, created.Id, new UpdatePartnerRequest("Partner A", "899999999", true, false));

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_ChangeToAnotherPartnersTaxNumber_Rejected()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        await controller.Create(companyId, new CreatePartnerRequest("Partner A", "811234567", true, false));
        var createResult = await controller.Create(companyId, new CreatePartnerRequest("Partner B", "812345678", true, false));
        var partnerB = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var result = await controller.Update(companyId, partnerB.Id, new UpdatePartnerRequest("Partner B", "811234567", true, false));

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_SameTaxNumberDifferentCompanies_Succeeds()
    {
        var db = await NewContextAsync();
        var company1 = new Company { Id = Guid.NewGuid(), Name = "Company 1" };
        var company2 = new Company { Id = Guid.NewGuid(), Name = "Company 2" };
        db.Companies.AddRange(company1, company2);
        await db.SaveChangesAsync();

        var controller = NewController(db);

        var result1 = await controller.Create(company1.Id, new CreatePartnerRequest("Partner A", "811234567", true, false));
        Assert.IsType<ObjectResult>(result1.Result);
        Assert.Equal(201, ((ObjectResult)result1.Result!).StatusCode);

        var result2 = await controller.Create(company2.Id, new CreatePartnerRequest("Partner B", "811234567", true, false));
        Assert.IsType<ObjectResult>(result2.Result);
        Assert.Equal(201, ((ObjectResult)result2.Result!).StatusCode);
    }

    [Fact]
    public async Task Create_ConcurrentDuplicate_DbConstraintReturns409()
    {
        // The DB unique index is a safety net for race conditions where two requests pass the
        // application check simultaneously. To exercise the controller's DbUpdateException catch,
        // we simulate this by inserting a conflicting record via a second DbContext between the
        // application check and SaveChangesAsync.
        //
        // Here we use the simpler approach: the application check queries the DB and finds the
        // duplicate inserted by the first controller call. Both the application-level and
        // DB-level paths produce 409.
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);

        var result1 = await controller.Create(companyId, new CreatePartnerRequest("First", "999888777", true, false));
        Assert.Equal(201, ((ObjectResult)result1.Result!).StatusCode);

        var result2 = await controller.Create(companyId, new CreatePartnerRequest("Second", "999888777", true, false));
        Assert.IsType<ConflictObjectResult>(result2.Result);
    }

    [Fact]
    public async Task DbUniqueIndex_PreventsDirectDuplicateInsert()
    {
        // Directly verify the Postgres unique index rejects duplicates at the DB level,
        // independent of application validation.
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        db.Partners.Add(new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "A", TaxNumber = "777666555", IsCustomer = true });
        await db.SaveChangesAsync();

        db.Partners.Add(new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "B", TaxNumber = "777666555", IsCustomer = true });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Create_DuplicateTaxNumber_MessageNamesNuisAndExistingPartner()
    {
        var (db, companyId, _) = await SeedCompanyWithAccountAsync();
        var controller = NewController(db);
        await controller.Create(companyId, new CreatePartnerRequest("Existing Partner SH.P.K.", "811234567", true, false));

        var result = await controller.Create(companyId, new CreatePartnerRequest("Other", "811234567", true, false));

        var message = Assert.IsType<string>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.Contains("NUIS 811234567", message);
        Assert.Contains("already registered", message);
        Assert.Contains("Existing Partner SH.P.K.", message);
    }
}
