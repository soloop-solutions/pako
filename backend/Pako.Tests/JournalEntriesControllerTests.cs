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
    private static async Task<(PakoDbContext Db, Guid CompanyId, Guid JournalId, Guid AccountAId, Guid AccountBId)> SeedAsync()
    {
        var db = new PakoDbContext(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 };
        var accountA = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Asset };
        var accountB = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "3000", Name = "Capital", AccountType = AccountType.Equity };

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
}
