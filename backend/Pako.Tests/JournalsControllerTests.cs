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
// after it finishes, which is what actually closes each test's dedicated Postgres connection.
public class JournalsControllerTests : IAsyncLifetime
{
    private static readonly Guid TestUserId = Guid.NewGuid();
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private static ClaimsPrincipal TestUser() =>
        new(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, TestUserId.ToString()) }, "TestAuth"));

    private static JournalsController NewJournalsController(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = TestUser() } }
        };

    private static JournalEntriesController NewEntriesController(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = TestUser() } }
        };

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid JournalId, Guid AccountAId, Guid AccountBId)> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 };
        var accountA = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Cash, IsPostable = true };
        var accountB = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "3000", Name = "Capital", AccountType = AccountType.Equity, IsPostable = true };

        db.Companies.Add(company);
        db.Journals.Add(journal);
        db.Accounts.AddRange(accountA, accountB);
        await db.SaveChangesAsync();

        return (db, company.Id, journal.Id, accountA.Id, accountB.Id);
    }

    private static CreateJournalEntryRequest MakeEntryRequest(Guid journalId, DateOnly date, Guid accountAId, Guid accountBId) =>
        new(journalId, date, null, new List<CreateJournalEntryLineRequest>
        {
            new(accountAId, null, 100m, 0m, null),
            new(accountBId, null, 0m, 100m, null)
        });

    [Fact]
    public async Task Secure_PostedEntries_AssignsChainedHashesAndSequentialNumbers()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var entriesController = NewEntriesController(db);
        var journalsController = NewJournalsController(db);

        var first = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(
            (await entriesController.Create(companyId, MakeEntryRequest(journalId, new DateOnly(2026, 8, 1), accountAId, accountBId))).Result).Value);
        await entriesController.Post(companyId, first.Id);
        var second = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(
            (await entriesController.Create(companyId, MakeEntryRequest(journalId, new DateOnly(2026, 8, 15), accountAId, accountBId))).Result).Value);
        await entriesController.Post(companyId, second.Id);

        var result = await journalsController.Secure(companyId, journalId, new SecureJournalRequest(new DateOnly(2026, 8, 31)));

        var response = Assert.IsType<SecureJournalResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, response.EntriesSecured);
        Assert.NotNull(response.LatestHash);
        Assert.Equal(2, response.LatestSecureSequenceNumber);

        var firstEntity = await db.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == first.Id);
        var secondEntity = await db.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == second.Id);
        Assert.Equal(HashChain.GenesisHash, firstEntity.PrevHash);
        Assert.Equal(1, firstEntity.SecureSequenceNumber);
        Assert.NotNull(firstEntity.EntryHash);
        Assert.Equal(firstEntity.EntryHash, secondEntity.PrevHash);
        Assert.Equal(2, secondEntity.SecureSequenceNumber);
        Assert.Equal(response.LatestHash, secondEntity.EntryHash);
    }

    [Fact]
    public async Task Secure_DraftEntryDatedOnOrBeforeUpTo_Rejected()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var entriesController = NewEntriesController(db);
        var journalsController = NewJournalsController(db);

        await entriesController.Create(companyId, MakeEntryRequest(journalId, new DateOnly(2026, 8, 1), accountAId, accountBId));

        var result = await journalsController.Secure(companyId, journalId, new SecureJournalRequest(new DateOnly(2026, 8, 31)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.JournalEntries.Where(e => e.SecureSequenceNumber != null).ToListAsync());
    }

    [Fact]
    public async Task Secure_EntryDatedAfterUpTo_NotSecured()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var entriesController = NewEntriesController(db);
        var journalsController = NewJournalsController(db);

        var entry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(
            (await entriesController.Create(companyId, MakeEntryRequest(journalId, new DateOnly(2026, 9, 15), accountAId, accountBId))).Result).Value);
        await entriesController.Post(companyId, entry.Id);

        var result = await journalsController.Secure(companyId, journalId, new SecureJournalRequest(new DateOnly(2026, 8, 31)));

        var response = Assert.IsType<SecureJournalResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(0, response.EntriesSecured);
        var entryEntity = await db.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == entry.Id);
        Assert.Null(entryEntity.EntryHash);
    }

    [Fact]
    public async Task Secure_CalledTwice_DoesNotReSecureAlreadySecuredEntries()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var entriesController = NewEntriesController(db);
        var journalsController = NewJournalsController(db);

        var entry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(
            (await entriesController.Create(companyId, MakeEntryRequest(journalId, new DateOnly(2026, 8, 1), accountAId, accountBId))).Result).Value);
        await entriesController.Post(companyId, entry.Id);
        await journalsController.Secure(companyId, journalId, new SecureJournalRequest(new DateOnly(2026, 8, 31)));
        var hashAfterFirstSecure = (await db.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == entry.Id)).EntryHash;

        var second = await journalsController.Secure(companyId, journalId, new SecureJournalRequest(new DateOnly(2026, 8, 31)));

        var secondResponse = Assert.IsType<SecureJournalResponse>(Assert.IsType<OkObjectResult>(second.Result).Value);
        Assert.Equal(0, secondResponse.EntriesSecured);
        var hashAfterSecondSecure = (await db.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == entry.Id)).EntryHash;
        Assert.Equal(hashAfterFirstSecure, hashAfterSecondSecure);
    }

    // B15: "freeze once hashed" — once EntryHash/PrevHash/SecureSequenceNumber are set, no further
    // change to them is ever allowed, even by another attempt to "re-secure" the same entry.
    [Fact]
    public async Task Secure_ThenDirectlyModifyingHashFields_ThrowsImmutabilityException()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var entriesController = NewEntriesController(db);
        var journalsController = NewJournalsController(db);

        var entry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(
            (await entriesController.Create(companyId, MakeEntryRequest(journalId, new DateOnly(2026, 8, 1), accountAId, accountBId))).Result).Value);
        await entriesController.Post(companyId, entry.Id);
        await journalsController.Secure(companyId, journalId, new SecureJournalRequest(new DateOnly(2026, 8, 31)));

        var tracked = await db.JournalEntries.SingleAsync(e => e.Id == entry.Id);
        tracked.EntryHash = "tampered";

        await Assert.ThrowsAsync<PostedJournalEntryImmutableException>(() => db.SaveChangesAsync());
    }
}
