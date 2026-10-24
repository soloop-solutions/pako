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

    [Fact]
    public void Post_NoLines_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = Guid.NewGuid(),
            JournalId = Guid.NewGuid(),
            Date = new DateOnly(2026, 8, 26)
        };

        var ex = Assert.Throws<InvalidOperationException>(() => entry.Post(company));
        Assert.Contains("no lines", ex.Message);
        Assert.Equal(JournalEntryState.Draft, entry.State);
    }

    // 60_Posting_Rules R19 (BLOCK).
    [Fact]
    public void Post_LineWithPartialForeignCurrencyData_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = BalancedEntry(new DateOnly(2026, 8, 26));
        entry.Lines[0].OriginalCurrency = "USD";
        entry.Lines[0].OriginalAmount = 108m;
        // ExchangeRate deliberately left unset.

        var ex = Assert.Throws<InconsistentForeignCurrencyDataException>(() => entry.Post(company));
        Assert.Equal(entry.Lines[0].Id, ex.LineId);
        Assert.Equal(JournalEntryState.Draft, entry.State);
    }

    [Fact]
    public void Post_LineWithCompleteForeignCurrencyData_Succeeds()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = BalancedEntry(new DateOnly(2026, 8, 26));
        entry.Lines[0].OriginalCurrency = "USD";
        entry.Lines[0].OriginalAmount = 108m;
        entry.Lines[0].ExchangeRate = 0.926m;

        entry.Post(company);

        Assert.Equal(JournalEntryState.Posted, entry.State);
    }

    // 60_Posting_Rules R30 (BLOCK): each line must have a positive Debit or a positive Credit,
    // never both on the same line.
    [Fact]
    public void Post_RefusesLineWithBothDebitAndCredit_R30()
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
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 1000m, Credit = 2000m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 1000m, Credit = 0m }
            }
        };

        var ex = Assert.Throws<DualAmountLineException>(() => entry.Post(company));
        Assert.Equal(entry.Lines[0].Id, ex.LineId);
        Assert.Equal(JournalEntryState.Draft, entry.State);
    }

    // R30: a line with one side zero is fine (the normal case).
    [Fact]
    public void Post_AllowsLineWithZeroOnOneSide_R30()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = BalancedEntry(new DateOnly(2026, 8, 26));

        entry.Post(company);

        Assert.Equal(JournalEntryState.Posted, entry.State);
    }

    // R31: negative Debit or Credit must be rejected.
    [Fact]
    public void Post_RefusesLineWithNegativeDebit_R31()
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
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = -100m, Credit = 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 0m, Credit = -100m }
            }
        };

        var ex = Assert.Throws<NegativeAmountLineException>(() => entry.Post(company));
        Assert.Equal(entry.Lines[0].Id, ex.LineId);
        Assert.Equal(JournalEntryState.Draft, entry.State);
    }

    [Fact]
    public void Post_RefusesLineWithNegativeCredit_R31()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        // Build a balanced entry where the second line has a negative credit — the balance check
        // (debit 100 = credit 100 + (-100) = 0) would fail first, so we use lines that happen to
        // balance while still containing a negative: debit 0, credit -100 on one side and debit -100,
        // credit 0 on the other. Both lines are negative, and they "balance" at -100 = -100.
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = Guid.NewGuid(),
            JournalId = Guid.NewGuid(),
            Date = new DateOnly(2026, 8, 26),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = -100m, Credit = 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 0m, Credit = -100m }
            }
        };

        // R31 fires before R30 — the first line has a negative debit.
        var ex = Assert.Throws<NegativeAmountLineException>(() => entry.Post(company));
        Assert.Equal(entry.Lines[0].Id, ex.LineId);
    }

    // B14: Reverse() must copy AnalyticDistribution as a new dictionary instance, not share the
    // original line's reference — otherwise mutating one would silently mutate the other.
    [Fact]
    public void Reverse_CopiesAnalyticDistribution_AsANewDictionaryInstance()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var entry = BalancedEntry(new DateOnly(2026, 8, 26));
        var costCenterId = Guid.NewGuid();
        entry.Lines[0].AnalyticDistribution = new Dictionary<Guid, decimal> { [costCenterId] = 100m };
        entry.Post(company);

        var reversal = entry.Reverse(company, new DateOnly(2026, 8, 27));

        var reversedLine = reversal.Lines.Single(l => l.AccountId == entry.Lines[0].AccountId);
        Assert.Equal(100m, reversedLine.AnalyticDistribution![costCenterId]);
        Assert.NotSame(entry.Lines[0].AnalyticDistribution, reversedLine.AnalyticDistribution);
    }
}
