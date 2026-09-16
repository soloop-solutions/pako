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
public class JournalEntriesControllerTests : IAsyncLifetime
{
    private static readonly Guid TestUserId = Guid.NewGuid();
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private static JournalEntriesController NewController(PakoDbContext db)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, TestUserId.ToString()) }, "TestAuth"));

        return new JournalEntriesController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

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

    [Fact]
    public async Task Create_AmountExceedingNumericCapacity_RejectedWithBadRequest()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var controller = new JournalEntriesController(db, new NullStringLocalizer<ErrorMessages>());

        var request = new CreateJournalEntryRequest(journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
        {
            new(accountAId, null, 99999999999999999.99m, 0m, null),
            new(accountBId, null, 0m, 99999999999999999.99m, null)
        });

        var result = await controller.Create(companyId, request);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_AmountWithinNumericCapacity_Succeeds()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var controller = new JournalEntriesController(db, new NullStringLocalizer<ErrorMessages>());

        var request = new CreateJournalEntryRequest(journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
        {
            new(accountAId, null, 100m, 0m, null),
            new(accountBId, null, 0m, 100m, null)
        });

        var result = await controller.Create(companyId, request);

        Assert.IsType<ObjectResult>(result.Result);
    }

    [Fact]
    public async Task Post_ZeroLineEntry_RejectedWithBadRequest()
    {
        var (db, companyId, journalId, _, _) = await SeedAsync();
        var controller = NewController(db);

        var entry = new JournalEntry { Id = Guid.NewGuid(), CompanyId = companyId, JournalId = journalId, Date = new DateOnly(2026, 8, 26) };
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var result = await controller.Post(companyId, entry.Id);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("no lines", badRequest.Value!.ToString());
    }

    // 60_Posting_Rules R02 (BLOCK).
    [Fact]
    public async Task Create_LineOnNonPostableAccount_Rejected()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var nonPostable = await db.Accounts.SingleAsync(a => a.Id == accountAId);
        nonPostable.IsPostable = false;
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var request = new CreateJournalEntryRequest(journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
        {
            new(accountAId, null, 100m, 0m, null),
            new(accountBId, null, 0m, 100m, null)
        });

        var result = await controller.Create(companyId, request);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("not postable", badRequest.Value!.ToString());
    }

    // 60_Posting_Rules R04 (BLOCK) — control accounts reject manual postings.
    [Fact]
    public async Task Create_LineOnControlAccount_Rejected()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var control = await db.Accounts.SingleAsync(a => a.Id == accountAId);
        control.IsControl = true;
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var request = new CreateJournalEntryRequest(journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
        {
            new(accountAId, null, 100m, 0m, null),
            new(accountBId, null, 0m, 100m, null)
        });

        var result = await controller.Create(companyId, request);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("control account", badRequest.Value!.ToString());
    }

    // 60_Posting_Rules R05 (BLOCK) — 304100 Current Year Profit/Loss is system-computed.
    [Fact]
    public async Task Create_LineOnCurrentYearProfitLossAccount_Rejected()
    {
        var (db, companyId, journalId, _, accountBId) = await SeedAsync();
        var systemComputed = new Account { Id = Guid.NewGuid(), CompanyId = companyId, Code = "304100", Name = "Current Year Profit/Loss", AccountType = AccountType.CurrentYearEarnings, IsPostable = true };
        db.Accounts.Add(systemComputed);
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var request = new CreateJournalEntryRequest(journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
        {
            new(systemComputed.Id, null, 100m, 0m, null),
            new(accountBId, null, 0m, 100m, null)
        });

        var result = await controller.Create(companyId, request);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("system-computed", badRequest.Value!.ToString());
    }

    // 60_Posting_Rules R03 (BLOCK, Partner subledger).
    [Fact]
    public async Task Create_PartnerSubledgerAccountWithNoPartnerId_Rejected()
    {
        var (db, companyId, journalId, _, accountBId) = await SeedAsync();
        var partnerSubledger = new Account { Id = Guid.NewGuid(), CompanyId = companyId, Code = "1200", Name = "Receivable", AccountType = AccountType.Receivable, IsPostable = true, Subledger = SubledgerType.Partner };
        db.Accounts.Add(partnerSubledger);
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var request = new CreateJournalEntryRequest(journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
        {
            new(partnerSubledger.Id, null, 100m, 0m, null),
            new(accountBId, null, 0m, 100m, null)
        });

        var result = await controller.Create(companyId, request);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("Partner subledger", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task Create_PartnerSubledgerAccountWithPartnerId_Accepted()
    {
        var (db, companyId, journalId, _, accountBId) = await SeedAsync();
        var partnerSubledger = new Account { Id = Guid.NewGuid(), CompanyId = companyId, Code = "1200", Name = "Receivable", AccountType = AccountType.Receivable, IsPostable = true, Subledger = SubledgerType.Partner };
        db.Accounts.Add(partnerSubledger);
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var request = new CreateJournalEntryRequest(journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
        {
            new(partnerSubledger.Id, Guid.NewGuid(), 100m, 0m, null),
            new(accountBId, null, 0m, 100m, null)
        });

        var result = await controller.Create(companyId, request);

        Assert.Equal(201, ((ObjectResult)result.Result!).StatusCode);
    }

    // B14: AnalyticDistribution round-trips through the API — the Create response carries it back
    // immediately, and a fresh List call (there is no single-entry GET) proves it was actually
    // persisted, not just echoed from the request.
    [Fact]
    public async Task Create_WithAnalyticDistribution_RoundTripsThroughCreateAndList()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var controller = NewController(db);
        var costCenterA = Guid.NewGuid();
        var costCenterB = Guid.NewGuid();
        var distribution = new Dictionary<Guid, decimal> { [costCenterA] = 60m, [costCenterB] = 40m };

        var request = new CreateJournalEntryRequest(journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
        {
            new(accountAId, null, 100m, 0m, null, distribution),
            new(accountBId, null, 0m, 100m, null)
        });

        var created = await controller.Create(companyId, request);
        var createdEntry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        var createdLine = createdEntry.Lines.Single(l => l.AccountId == accountAId);
        Assert.NotNull(createdLine.AnalyticDistribution);
        Assert.Equal(60m, createdLine.AnalyticDistribution![costCenterA]);
        Assert.Equal(40m, createdLine.AnalyticDistribution[costCenterB]);
        Assert.Null(createdEntry.Lines.Single(l => l.AccountId == accountBId).AnalyticDistribution);

        var listed = await controller.List(companyId);
        var listedEntry = Assert.IsType<List<JournalEntryResponse>>(Assert.IsType<OkObjectResult>(listed.Result).Value)
            .Single(e => e.Id == createdEntry.Id);
        var listedLine = listedEntry.Lines.Single(l => l.AccountId == accountAId);
        Assert.NotNull(listedLine.AnalyticDistribution);
        Assert.Equal(60m, listedLine.AnalyticDistribution![costCenterA]);
        Assert.Equal(40m, listedLine.AnalyticDistribution[costCenterB]);
    }

    // R23: JournalEntry.SequenceNumber, gapless/monotonic per journal, same pattern as invoice
    // numbering. Also verifies R28's PostedByUserId gets set.
    [Fact]
    public async Task Post_AssignsGaplessMonotonicSequenceNumbersAndRecordsPostedByUserId()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var controller = NewController(db);

        var numbers = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            var created = await controller.Create(companyId, new CreateJournalEntryRequest(
                journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
                {
                    new(accountAId, null, 100m, 0m, null),
                    new(accountBId, null, 0m, 100m, null)
                }));
            var entry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

            var posted = await controller.Post(companyId, entry.Id);
            var response = Assert.IsType<JournalEntryResponse>(Assert.IsType<OkObjectResult>(posted.Result).Value);
            numbers.Add(response.SequenceNumber!);
        }

        Assert.Equal(new[] { "GEN-0001", "GEN-0002", "GEN-0003" }, numbers);

        var lastEntry = await db.JournalEntries.AsNoTracking().FirstAsync(e => e.SequenceNumber == "GEN-0003");
        Assert.Equal(TestUserId, lastEntry.PostedByUserId);
    }

    // R16 (storno).
    [Fact]
    public async Task Reverse_PostedEntry_CreatesPostedMirrorAndCancelsOriginal()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, new CreateJournalEntryRequest(
            journalId, new DateOnly(2026, 8, 26), "Original", new List<CreateJournalEntryLineRequest>
            {
                new(accountAId, null, 100m, 0m, null),
                new(accountBId, null, 0m, 100m, null)
            }));
        var entry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, entry.Id);

        var reversed = await controller.Reverse(companyId, entry.Id, new ReverseJournalEntryRequest(new DateOnly(2026, 8, 27)));

        var reversal = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(reversed.Result).Value);
        Assert.Equal(201, ((ObjectResult)reversed.Result!).StatusCode);
        Assert.Equal("Posted", reversal.State);
        Assert.Equal(100m, reversal.Lines.Single(l => l.AccountId == accountAId).Credit);
        Assert.Equal(0m, reversal.Lines.Single(l => l.AccountId == accountAId).Debit);

        var original = await db.JournalEntries.AsNoTracking().FirstAsync(e => e.Id == entry.Id);
        Assert.Equal(JournalEntryState.Cancelled, original.State);

        var reversalEntity = await db.JournalEntries.AsNoTracking().FirstAsync(e => e.Id == reversal.Id);
        Assert.Equal(entry.Id, reversalEntity.SourceDocumentId);
    }

    // B14: AnalyticDistribution round-trips through the jsonb column (proves the converter +
    // value comparer are wired correctly, not just that the code compiles) across a real
    // Create -> Post -> Reverse flow, and the reversal's own copy keeps the same split. The
    // independent-dictionary-instance guarantee itself (Reverse() doesn't share the original
    // line's reference) is proven at the domain level, with no DB involved, by
    // JournalEntryPostingTests.Reverse_CopiesAnalyticDistribution_AsANewDictionaryInstance —
    // not repeated here by mutating a Posted line's dictionary in place, which
    // PakoDbContext.ValidateImmutability correctly refuses to save regardless of B14.
    [Fact]
    public async Task Reverse_CopiesAnalyticDistribution_ThroughRoundTrip()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var costCenterId = Guid.NewGuid();
        var controller = NewController(db);

        var created = await controller.Create(companyId, new CreateJournalEntryRequest(
            journalId, new DateOnly(2026, 8, 26), "Original", new List<CreateJournalEntryLineRequest>
            {
                new(accountAId, null, 100m, 0m, null),
                new(accountBId, null, 0m, 100m, null)
            }));
        var entry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var trackedLine = await db.JournalEntryLines.SingleAsync(l => l.JournalEntryId == entry.Id && l.AccountId == accountAId);
        trackedLine.AnalyticDistribution = new Dictionary<Guid, decimal> { [costCenterId] = 60m, [Guid.NewGuid()] = 40m };
        await db.SaveChangesAsync();

        await controller.Post(companyId, entry.Id);
        var reversed = await controller.Reverse(companyId, entry.Id, new ReverseJournalEntryRequest(new DateOnly(2026, 8, 27)));
        var reversal = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(reversed.Result).Value);

        var reversalLine = await db.JournalEntryLines.AsNoTracking()
            .SingleAsync(l => l.JournalEntryId == reversal.Id && l.AccountId == accountAId);
        Assert.NotNull(reversalLine.AnalyticDistribution);
        Assert.Equal(60m, reversalLine.AnalyticDistribution![costCenterId]);
        Assert.Equal(2, reversalLine.AnalyticDistribution.Count);

        var originalLineAfter = await db.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == trackedLine.Id);
        Assert.Equal(60m, originalLineAfter.AnalyticDistribution![costCenterId]);
    }

    [Fact]
    public async Task Reverse_DraftEntry_Rejected()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, new CreateJournalEntryRequest(
            journalId, new DateOnly(2026, 8, 26), null, new List<CreateJournalEntryLineRequest>
            {
                new(accountAId, null, 100m, 0m, null),
                new(accountBId, null, 0m, 100m, null)
            }));
        var entry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Reverse(companyId, entry.Id, new ReverseJournalEntryRequest(new DateOnly(2026, 8, 27)));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("only Posted entries can be reversed", badRequest.Value!.ToString());
    }

    // B11: the export resolves account code/name and partner name itself rather than reusing
    // JournalEntryResponse's raw ids — this proves the file it hands back actually carries those
    // readable identifiers, not just Guids.
    [Fact]
    public async Task Export_ReturnsXlsxWithAccountCodeAndAmounts()
    {
        var (db, companyId, journalId, accountAId, accountBId) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, new CreateJournalEntryRequest(
            journalId, new DateOnly(2026, 8, 26), "Opening balance", new List<CreateJournalEntryLineRequest>
            {
                new(accountAId, null, 100m, 0m, "Cash in"),
                new(accountBId, null, 0m, 100m, "Capital contribution")
            }));
        var entry = Assert.IsType<JournalEntryResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Export(companyId, entry.Id);

        var fileResult = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileResult.ContentType);
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(fileResult.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Account Code", sheet.Cell(1, 1).GetString());

        // Line order isn't guaranteed by EF's Include, so match by account code instead of row.
        var dataRows = sheet.RowsUsed().Skip(1).ToList();
        var cashRow = dataRows.Single(r => r.Cell(1).GetString() == "1000");
        Assert.Equal(100m, cashRow.Cell(4).GetValue<decimal>());
        var capitalRow = dataRows.Single(r => r.Cell(1).GetString() == "3000");
        Assert.Equal(100m, capitalRow.Cell(5).GetValue<decimal>());
    }

    [Fact]
    public async Task Export_UnknownId_ReturnsNotFound()
    {
        var (db, companyId, _, _, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Export(companyId, Guid.NewGuid());

        Assert.IsType<NotFoundResult>(result);
    }
}
