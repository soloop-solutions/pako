using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

public class JournalEntriesControllerTests
{
    private static readonly Guid TestUserId = Guid.NewGuid();

    private static JournalEntriesController NewController(PakoDbContext db)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, TestUserId.ToString()) }, "TestAuth"));

        return new JournalEntriesController(db)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    private static async Task<(PakoDbContext Db, Guid CompanyId, Guid JournalId, Guid AccountAId, Guid AccountBId)> SeedAsync()
    {
        var db = new PakoDbContext(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 };
        var accountA = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Asset, IsPostable = true };
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
        var controller = new JournalEntriesController(db);

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
        var controller = new JournalEntriesController(db);

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
        var controller = new JournalEntriesController(db);

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
        var systemComputed = new Account { Id = Guid.NewGuid(), CompanyId = companyId, Code = "304100", Name = "Current Year Profit/Loss", AccountType = AccountType.Equity, IsPostable = true };
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
        var partnerSubledger = new Account { Id = Guid.NewGuid(), CompanyId = companyId, Code = "1200", Name = "Receivable", AccountType = AccountType.Asset, IsPostable = true, Subledger = SubledgerType.Partner };
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
        var partnerSubledger = new Account { Id = Guid.NewGuid(), CompanyId = companyId, Code = "1200", Name = "Receivable", AccountType = AccountType.Asset, IsPostable = true, Subledger = SubledgerType.Partner };
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
}
