using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

public class FavoritesControllerTests : IAsyncLifetime
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

    private static FavoritesController NewController(PakoDbContext db, Guid userId)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"));

        return new FavoritesController(db)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid AccountId)> SeedAsync()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Fav Co" };
        db.Companies.Add(company);
        var account = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "100100", Name = "Main Cash", AccountType = AccountType.Cash };
        db.Accounts.Add(account);
        await db.SaveChangesAsync();
        return (db, company.Id, account.Id);
    }

    [Fact]
    public async Task Pin_CreatesNewFavorite()
    {
        var (db, companyId, accountId) = await SeedAsync();
        var userId = Guid.NewGuid();
        var controller = NewController(db, userId);

        var result = await controller.Pin(companyId, "Account", accountId, new PinFavoriteRequest(true));

        var fav = Assert.IsType<FavoriteResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(fav.IsPinned);
        Assert.Equal(accountId, fav.EntityId);
        Assert.Equal("Account", fav.EntityType);
    }

    [Fact]
    public async Task Pin_ThenUnpin_WorksCorrectly()
    {
        var (db, companyId, accountId) = await SeedAsync();
        var userId = Guid.NewGuid();
        var controller = NewController(db, userId);

        await controller.Pin(companyId, "Account", accountId, new PinFavoriteRequest(true));
        var result = await controller.Pin(companyId, "Account", accountId, new PinFavoriteRequest(false));

        var fav = Assert.IsType<FavoriteResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.False(fav.IsPinned);
    }

    [Fact]
    public async Task Suppress_PreventsAutoFavorite()
    {
        var (db, companyId, accountId) = await SeedAsync();
        var userId = Guid.NewGuid();
        var controller = NewController(db, userId);

        var result = await controller.Suppress(companyId, "Account", accountId, new SuppressFavoriteRequest(true));

        var fav = Assert.IsType<FavoriteResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(fav.IsSuppressed);
    }

    [Fact]
    public async Task Pin_ClearsSuppression()
    {
        var (db, companyId, accountId) = await SeedAsync();
        var userId = Guid.NewGuid();
        var controller = NewController(db, userId);

        await controller.Suppress(companyId, "Account", accountId, new SuppressFavoriteRequest(true));
        var result = await controller.Pin(companyId, "Account", accountId, new PinFavoriteRequest(true));

        var fav = Assert.IsType<FavoriteResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(fav.IsPinned);
        Assert.False(fav.IsSuppressed);
    }

    [Fact]
    public async Task RecordSelections_IncrementsCount()
    {
        var (db, companyId, accountId) = await SeedAsync();
        var userId = Guid.NewGuid();
        var controller = NewController(db, userId);

        await controller.RecordSelections(companyId, new RecordSelectionsRequest(
            new List<RecordSelectionRequest>
            {
                new(accountId, "Account"),
                new(accountId, "Account"),
            }));

        var listResult = await controller.List(companyId, "Account");
        var list = Assert.IsType<FavoritesListResponse>(Assert.IsType<OkObjectResult>(listResult.Result).Value);
        Assert.Single(list.Items);
        Assert.Equal(2, list.Items[0].SelectionCount);
    }

    [Fact]
    public async Task List_UserIsolation_OtherUserSeesNothing()
    {
        var (db, companyId, accountId) = await SeedAsync();
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();

        var controllerA = NewController(db, userA);
        await controllerA.Pin(companyId, "Account", accountId, new PinFavoriteRequest(true));

        var controllerB = NewController(db, userB);
        var result = await controllerB.List(companyId, "Account");
        var list = Assert.IsType<FavoritesListResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(list.Items);
    }

    [Fact]
    public async Task List_CompanyIsolation_OtherCompanySeesNothing()
    {
        var db = await NewContextAsync();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Co A" };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Co B" };
        db.Companies.AddRange(companyA, companyB);
        var account = new Account { Id = Guid.NewGuid(), CompanyId = companyA.Id, Code = "100100", Name = "Cash", AccountType = AccountType.Cash };
        db.Accounts.Add(account);
        await db.SaveChangesAsync();

        var userId = Guid.NewGuid();
        var controller = NewController(db, userId);
        await controller.Pin(companyA.Id, "Account", account.Id, new PinFavoriteRequest(true));

        var result = await controller.List(companyB.Id, "Account");
        var list = Assert.IsType<FavoritesListResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(list.Items);
    }

    [Fact]
    public async Task Pin_InvalidEntityType_ReturnsBadRequest()
    {
        var (db, companyId, accountId) = await SeedAsync();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Pin(companyId, "InvalidType", accountId, new PinFavoriteRequest(true));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task List_PinnedFirstThenByCount()
    {
        var (db, companyId, _) = await SeedAsync();
        var userId = Guid.NewGuid();
        var controller = NewController(db, userId);

        var acctA = Guid.NewGuid();
        var acctB = Guid.NewGuid();

        // Record many selections for acctA (automatic favorite)
        await controller.RecordSelections(companyId, new RecordSelectionsRequest(
            Enumerable.Repeat(new RecordSelectionRequest(acctA, "Account"), 10).ToList()));

        // Pin acctB (manual favorite, no selections)
        await controller.Pin(companyId, "Account", acctB, new PinFavoriteRequest(true));

        var result = await controller.List(companyId, "Account");
        var list = Assert.IsType<FavoritesListResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.Equal(2, list.Items.Count);
        // Pinned first, regardless of selection count
        Assert.Equal(acctB, list.Items[0].EntityId);
        Assert.True(list.Items[0].IsPinned);
        Assert.Equal(acctA, list.Items[1].EntityId);
        Assert.Equal(10, list.Items[1].SelectionCount);
    }
}
