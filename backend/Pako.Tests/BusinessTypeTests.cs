using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Tests;

// docs/COMPANY_TYPES.md: a company's business type picks its vertical packs (and, at creation, its
// modules); a pack's endpoints refuse a company that doesn't use it.
public class BusinessTypeTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private async Task<(PakoDbContext Db, CompaniesController Companies)> SetupAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var user = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));
        var controller = new CompaniesController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } },
        };
        return (db, controller);
    }

    private static CompanyResponse Created(ActionResult<CompanyResponse> result) =>
        (CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(result.Result).Value!;

    [Fact]
    public async Task ATypePicksItsPacksAndModules_AndGeneralKeepsEverything()
    {
        var (db, companies) = await SetupAsync();
        var hotel = Created(await companies.Create(new CreateCompanyRequest("Hotel Co", BusinessType: BusinessType.Hotel)));
        Assert.Equal(BusinessType.Hotel, hotel.BusinessType);
        Assert.Equal(new[] { "hospitality", "hotel", "events" }, hotel.Features);
        Assert.Equal(AppModule.All, (await db.Companies.SingleAsync(c => c.Id == hotel.Id)).EnabledModules);

        var estate = Created(await companies.Create(new CreateCompanyRequest("Estate Co", BusinessType: BusinessType.RealEstate)));
        var modules = (await db.Companies.SingleAsync(c => c.Id == estate.Id)).EnabledModules;
        Assert.False(modules.HasFlag(AppModule.Pos));
        Assert.False(modules.HasFlag(AppModule.Inventory));
        Assert.Equal(new[] { "realEstate", "rentals" }, estate.Features);

        var general = Created(await companies.Create(new CreateCompanyRequest("Mixed Co")));
        Assert.Equal(BusinessTypes.Selectable.Length, general.Features!.Count);

        // Changing the type resets the packs to the new type's.
        var changed = (CompanyResponse)Assert.IsType<OkObjectResult>(
            (await companies.UpdateBusinessType(general.Id, new UpdateBusinessTypeRequest(BusinessType.Pharmacy))).Result).Value!;
        Assert.Equal(new[] { "pharmacy", "onlineSales" }, changed.Features);
        Assert.True(BusinessTypes.TryParse(new[] { "hotel", "Rentals" }, out var parsed));
        Assert.Equal(CompanyFeature.Hotel | CompanyFeature.Rentals, parsed);
        Assert.False(BusinessTypes.TryParse(new[] { "spaceships" }, out _));
    }

    [Fact]
    public async Task APacksEndpoints_RefuseACompanyThatDoesNotUseIt()
    {
        var (db, companies) = await SetupAsync();
        var market = Created(await companies.Create(new CreateCompanyRequest("Market Co", BusinessType: BusinessType.Market)));

        async Task<IActionResult?> Run(CompanyFeature anyOf)
        {
            var http = new DefaultHttpContext { RequestServices = new EmptyServices() };
            var routes = new RouteData();
            routes.Values["companyId"] = market.Id.ToString();
            var context = new ActionExecutingContext(new ActionContext(http, routes, new ActionDescriptor()), new List<IFilterMetadata>(),
                new Dictionary<string, object?>(), controller: new object());
            var ran = false;
            await new CompanyFeatureFilter(db, anyOf).OnActionExecutionAsync(context, () =>
            {
                ran = true;
                return Task.FromResult(new ActionExecutedContext(context, new List<IFilterMetadata>(), new object()));
            });
            return ran ? null : context.Result;
        }

        var refused = Assert.IsType<ObjectResult>(await Run(CompanyFeature.Hotel));
        Assert.Equal(StatusCodes.Status403Forbidden, refused.StatusCode);
        Assert.Null(await Run(CompanyFeature.Grocery));
        // Any one of the named packs is enough.
        Assert.Null(await Run(CompanyFeature.Hotel | CompanyFeature.OnlineSales));
    }

    private sealed class EmptyServices : IServiceProvider
    {
        public object? GetService(Type serviceType) => null;
    }
}
