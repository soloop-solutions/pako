using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection —
// without it, connections pile up across the run and Postgres refuses new ones past max_connections.
public class ItemsControllerTests : IAsyncLifetime
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

    private static ItemsController NewController(PakoDbContext db) => new(db, new NumberSeriesService(db));

    private async Task<(PakoDbContext Db, Guid CompanyId)> SeedCompanyAsync()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return (db, company.Id);
    }

    [Fact]
    public async Task Create_Succeeds_DefaultsToGoodsType()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateItemRequest("Widget", "pcs"));

        var created = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("Widget", created.Name);
        Assert.Equal(ItemType.Goods, created.Type);
        Assert.Equal(1, created.Code);
    }

    [Fact]
    public async Task Create_AssignsSequentialCodes()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var first = await controller.Create(companyId, new CreateItemRequest("Widget A", "pcs"));
        var second = await controller.Create(companyId, new CreateItemRequest("Widget B", "pcs"));

        var firstCreated = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(first.Result).Value);
        var secondCreated = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(second.Result).Value);
        Assert.Equal(1, firstCreated.Code);
        Assert.Equal(2, secondCreated.Code);
    }

    [Fact]
    public async Task Create_MissingName_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateItemRequest("  ", "pcs"));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_WithServiceType_Succeeds()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateItemRequest("Consulting Hour", "hr", ItemType.Service));

        var created = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(ItemType.Service, created.Type);
    }

    [Fact]
    public async Task Update_ChangesFieldsIncludingDefaultAccounts()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var revenueAccountId = Guid.NewGuid();
        var createResult = await controller.Create(companyId, new CreateItemRequest("Widget", "pcs"));
        var created = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var updateResult = await controller.Update(companyId, created.Id, new UpdateItemRequest(
            "Widget Deluxe", "pcs", ItemType.Goods, null, revenueAccountId, null, null, 25.50m));

        var updated = Assert.IsType<ItemResponse>(Assert.IsType<OkObjectResult>(updateResult.Result).Value);
        Assert.Equal("Widget Deluxe", updated.Name);
        Assert.Equal(revenueAccountId, updated.DefaultRevenueAccountId);
        Assert.Equal(25.50m, updated.DefaultUnitPrice);
    }

    [Fact]
    public async Task AddBarcode_Succeeds_AndAppearsOnItem()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var createResult = await controller.Create(companyId, new CreateItemRequest("Widget", "pcs"));
        var created = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var result = await controller.AddBarcode(companyId, created.Id, new AddBarcodeRequest("012345678905"));

        Assert.IsType<ObjectResult>(result.Result);
        var getResult = await controller.Get(companyId, created.Id);
        var item = Assert.IsType<ItemResponse>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Contains(item.Barcodes, b => b.Barcode == "012345678905");
    }

    // B6: ItemBarcode is unique per company (not globally) — two different items in two
    // different companies may share a barcode.
    [Fact]
    public async Task AddBarcode_AlreadyUsedInSameCompany_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var firstResult = await controller.Create(companyId, new CreateItemRequest("Widget A", "pcs"));
        var first = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(firstResult.Result).Value);
        var secondResult = await controller.Create(companyId, new CreateItemRequest("Widget B", "pcs"));
        var second = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(secondResult.Result).Value);
        await controller.AddBarcode(companyId, first.Id, new AddBarcodeRequest("012345678905"));

        var result = await controller.AddBarcode(companyId, second.Id, new AddBarcodeRequest("012345678905"));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task RemoveBarcode_Succeeds()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var createResult = await controller.Create(companyId, new CreateItemRequest("Widget", "pcs"));
        var created = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);
        var addResult = await controller.AddBarcode(companyId, created.Id, new AddBarcodeRequest("012345678905"));
        var barcode = Assert.IsType<ItemBarcodeResponse>(Assert.IsType<ObjectResult>(addResult.Result).Value);

        var result = await controller.RemoveBarcode(companyId, created.Id, barcode.Id);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task List_SearchesByNameCodeAndBarcode()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var laptopResult = await controller.Create(companyId, new CreateItemRequest("Laptop Stand", "pcs"));
        var laptop = Assert.IsType<ItemResponse>(Assert.IsType<ObjectResult>(laptopResult.Result).Value);
        await controller.Create(companyId, new CreateItemRequest("Desk Chair", "pcs"));
        await controller.AddBarcode(companyId, laptop.Id, new AddBarcodeRequest("999888777"));

        var byName = await controller.List(companyId, search: "laptop");
        var byBarcode = await controller.List(companyId, search: "999888777");

        var byNameResponse = Assert.IsType<PaginatedResponse<ItemResponse>>(Assert.IsType<OkObjectResult>(byName.Result).Value);
        var byBarcodeResponse = Assert.IsType<PaginatedResponse<ItemResponse>>(Assert.IsType<OkObjectResult>(byBarcode.Result).Value);
        Assert.Single(byNameResponse.Items);
        Assert.Single(byBarcodeResponse.Items);
        Assert.Equal(laptop.Id, byNameResponse.Items[0].Id);
    }
}
