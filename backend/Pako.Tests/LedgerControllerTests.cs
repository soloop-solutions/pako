using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

// Trial balance rows sort by Account.CreatedAt (insertion order), not by Code — confirmed
// directly by seeding accounts with codes deliberately out of creation order.
public class LedgerControllerTests
{
    [Fact]
    public async Task TrialBalance_OrdersByAccountCreatedAt_NotByCode()
    {
        var db = new PakoDbContext(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };

        // Code order would be 1000 < 2000 < 3000; creation order is deliberately the reverse.
        var accountA = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "3000", Name = "Third", AccountType = AccountType.Equity, CreatedAt = DateTime.UtcNow.AddMinutes(-3) };
        var accountB = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "2000", Name = "Second", AccountType = AccountType.Liability, CreatedAt = DateTime.UtcNow.AddMinutes(-2) };
        var accountC = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "First", AccountType = AccountType.Asset, CreatedAt = DateTime.UtcNow.AddMinutes(-1) };

        db.Companies.Add(company);
        db.Journals.Add(journal);
        db.Accounts.AddRange(accountA, accountB, accountC);

        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = journal.Id,
            Date = new DateOnly(2026, 9, 1),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountA.Id, Debit = 0m, Credit = 100m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountB.Id, Debit = 0m, Credit = 100m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountC.Id, Debit = 200m, Credit = 0m }
            }
        };
        entry.Post(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var controller = new LedgerController(db);

        var result = await controller.TrialBalance(company.Id);

        var lines = Assert.IsType<List<TrialBalanceLine>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new[] { "3000", "2000", "1000" }, lines.Select(l => l.AccountCode));
    }
}
