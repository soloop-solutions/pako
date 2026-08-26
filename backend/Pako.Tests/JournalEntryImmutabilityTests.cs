using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

public class JournalEntryImmutabilityTests
{
    private static PakoDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PakoDbContext(options);
    }

    private static async Task<(PakoDbContext Db, JournalEntry Entry)> SeedPostedEntry()
    {
        var db = NewContext();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = Guid.NewGuid(),
            Date = new DateOnly(2026, 8, 26),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 100m, Credit = 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 0m, Credit = 100m }
            }
        };
        entry.Post(company);

        db.Companies.Add(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        return (db, entry);
    }

    [Fact]
    public async Task ModifyingPostedJournalEntry_Throws()
    {
        var (db, entry) = await SeedPostedEntry();

        entry.Reference = "changed";

        await Assert.ThrowsAsync<PostedJournalEntryImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task DeletingPostedJournalEntry_Throws()
    {
        var (db, entry) = await SeedPostedEntry();

        db.JournalEntries.Remove(entry);

        await Assert.ThrowsAsync<PostedJournalEntryImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task ModifyingLineOfPostedJournalEntry_Throws()
    {
        var (db, entry) = await SeedPostedEntry();

        entry.Lines[0].Description = "changed";

        await Assert.ThrowsAsync<PostedJournalEntryImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task ModifyingDraftJournalEntry_Succeeds()
    {
        var db = NewContext();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = Guid.NewGuid(),
            Date = new DateOnly(2026, 8, 26)
        };
        db.Companies.Add(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        entry.Reference = "draft edit";
        await db.SaveChangesAsync();

        Assert.Equal("draft edit", entry.Reference);
    }
}
