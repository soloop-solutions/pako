using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class PrLeftoversTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private static T As<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
            }
        };
        return controller;
    }

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid UserId)> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var userId = Guid.NewGuid();
        var created = await As(new CompaniesController(db, new NullStringLocalizer<ErrorMessages>()), userId).Create(new CreateCompanyRequest("Leftovers Co"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;
        return (db, companyId, userId);
    }

    [Fact]
    public void LikePattern_EscapesBackslashPercentAndUnderscore()
    {
        Assert.Equal("%100\\%%", LikePattern.Contains(" 100% "));
        Assert.Equal("%a\\_b%", LikePattern.Contains("a_b"));
        Assert.Equal("%a\\\\b%", LikePattern.Contains("a\\b"));
    }

    [Fact]
    public async Task PartnersSearch_PercentAndUnderscoreMatchOnlyLiteralOccurrences()
    {
        var (db, companyId, userId) = await SeedAsync();
        db.Partners.AddRange(
            new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Alpha 100% Co" },
            new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Beta_Trade" },
            new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Gamma Plain" },
            new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Delta Plain" });
        await db.SaveChangesAsync();
        var controller = As(new PartnersController(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), userId);

        async Task<List<string>> Names(string search)
        {
            var page = (PaginatedResponse<PartnerResponse>)Assert.IsType<OkObjectResult>((await controller.ListPaged(companyId, search: search)).Result).Value!;
            return page.Items.Select(p => p.Name).ToList();
        }

        Assert.Equal(new[] { "Alpha 100% Co" }, await Names("%"));
        Assert.Equal(new[] { "Beta_Trade" }, await Names("_"));
        Assert.Empty(await Names("Plain_"));
        Assert.Equal(2, (await Names("plain")).Count);
    }

    [Fact]
    public async Task Warehouse_RefusesVanFlagAndDriver_UseVehicles()
    {
        var (db, companyId, userId) = await SeedAsync();
        var stock = new StockService(db, new NullStringLocalizer<ErrorMessages>());
        var inventory = As(new InventoryController(db, stock, new NullStringLocalizer<ErrorMessages>(), new TaxComputationService(), CompanyAccessContext.Unrestricted()), userId);

        Assert.IsType<BadRequestObjectResult>((await inventory.CreateWarehouse(companyId, new SaveWarehouseRequest("VAN1", "Van", null, IsVan: true))).Result);
        Assert.IsType<BadRequestObjectResult>((await inventory.CreateWarehouse(companyId, new SaveWarehouseRequest("VAN1", "Van", null, DriverUserId: userId))).Result);
        var ok = (WarehouseResponse)Assert.IsAssignableFrom<ObjectResult>((await inventory.CreateWarehouse(companyId, new SaveWarehouseRequest("MAIN", "Main", null))).Result).Value!;
        Assert.IsType<BadRequestObjectResult>((await inventory.UpdateWarehouse(companyId, ok.Id, new SaveWarehouseRequest("MAIN", "Main", null, IsVan: true))).Result);
        Assert.IsType<OkObjectResult>((await inventory.UpdateWarehouse(companyId, ok.Id, new SaveWarehouseRequest("MAIN", "Main 2", null))).Result);
    }
}
