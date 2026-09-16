using Pako.Domain.Ledger;

namespace Pako.Tests;

public class HashChainTests
{
    private static JournalEntry MakeEntry(string? sequenceNumber = "GEN-0001") => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        JournalId = Guid.NewGuid(),
        Date = new DateOnly(2026, 8, 26),
        SequenceNumber = sequenceNumber,
        Lines =
        {
            new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 100m, Credit = 0m },
            new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 0m, Credit = 100m }
        }
    };

    [Fact]
    public void ComputeEntryHash_SameInputs_AreDeterministic()
    {
        var entry = MakeEntry();

        var hash1 = HashChain.ComputeEntryHash(HashChain.GenesisHash, entry);
        var hash2 = HashChain.ComputeEntryHash(HashChain.GenesisHash, entry);

        Assert.Equal(hash1, hash2);
        Assert.Equal(64, hash1.Length); // sha256 hex string
    }

    [Fact]
    public void ComputeEntryHash_DifferentPreviousHash_ProducesDifferentHash()
    {
        var entry = MakeEntry();

        var hash1 = HashChain.ComputeEntryHash(HashChain.GenesisHash, entry);
        var hash2 = HashChain.ComputeEntryHash("some-other-previous-hash", entry);

        Assert.NotEqual(hash1, hash2);
    }

    [Fact]
    public void ComputeEntryHash_DifferentDebitCredit_ProducesDifferentHash()
    {
        var entryA = MakeEntry();
        var entryB = MakeEntry();
        entryB.Lines[0].Debit = 200m;

        var hashA = HashChain.ComputeEntryHash(HashChain.GenesisHash, entryA);
        var hashB = HashChain.ComputeEntryHash(HashChain.GenesisHash, entryB);

        Assert.NotEqual(hashA, hashB);
    }

    // The canonical record must not depend on collection load/insertion order — EF doesn't
    // guarantee one for a navigation collection, so the hash would be unreproducible if it did.
    [Fact]
    public void CanonicalRecord_IsIndependentOfLineCollectionOrder()
    {
        var lineA = new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 100m, Credit = 0m };
        var lineB = new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 0m, Credit = 100m };
        var entryForward = new JournalEntry { Id = Guid.NewGuid(), CompanyId = Guid.NewGuid(), JournalId = Guid.NewGuid(), Date = new DateOnly(2026, 8, 26), SequenceNumber = "GEN-0001", Lines = { lineA, lineB } };
        var entryReversed = new JournalEntry { Id = entryForward.Id, CompanyId = entryForward.CompanyId, JournalId = entryForward.JournalId, Date = entryForward.Date, SequenceNumber = entryForward.SequenceNumber, Lines = { lineB, lineA } };

        Assert.Equal(HashChain.CanonicalRecord(entryForward), HashChain.CanonicalRecord(entryReversed));
    }
}
