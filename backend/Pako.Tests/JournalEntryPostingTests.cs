using Pako.Domain.Companies;
using Pako.Domain.Ledger;

namespace Pako.Tests;

public class JournalEntryPostingTests
{
    private static JournalEntry BalancedEntry(DateOnly date) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        JournalId = Guid.NewGuid(),
        Date = date,
        Lines =
        {
            new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 100m, Credit = 0m },
            new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 0m, Credit = 100m }
        }
    };

    [Fact]
    public void Post_BalancedEntry_Succeeds()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = BalancedEntry(new DateOnly(2026, 8, 26));

        entry.Post(company);

        Assert.Equal(JournalEntryState.Posted, entry.State);
        Assert.NotNull(entry.PostedAtUtc);
    }

    [Fact]
    public void Post_UnbalancedEntry_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = Guid.NewGuid(),
            JournalId = Guid.NewGuid(),
            Date = new DateOnly(2026, 8, 26),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 100m, Credit = 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 0m, Credit = 50m }
            }
        };

        var ex = Assert.Throws<UnbalancedJournalEntryException>(() => entry.Post(company));
        Assert.Equal(entry.Id, ex.JournalEntryId);
        Assert.Equal(JournalEntryState.Draft, entry.State);
    }

    [Fact]
    public void Post_DatedOnOrBeforeAccountingLockDate_Throws()
    {
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Test Co",
            AccountingLockDate = new DateOnly(2026, 7, 31)
        };
        var entry = BalancedEntry(new DateOnly(2026, 7, 15));

        var ex = Assert.Throws<AccountingLockDateViolationException>(() => entry.Post(company));
        Assert.Equal(entry.Id, ex.JournalEntryId);
        Assert.Equal(JournalEntryState.Draft, entry.State);
    }

    [Fact]
    public void Post_AlreadyPostedEntry_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = BalancedEntry(new DateOnly(2026, 8, 26));
        entry.Post(company);

        Assert.Throws<InvalidOperationException>(() => entry.Post(company));
    }
}
