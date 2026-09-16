using System.Security.Cryptography;
using System.Text;

namespace Pako.Domain.Ledger;

// B15: sha256(previousHash + canonicalRecord), chained per company + journal — Odoo's
// inalterable_hash pattern (docs/ARCHITECTURE.md's "Hash-chain / immutability reservation"
// section, written when EntryHash/PrevHash/SecureSequenceNumber were reserved but unused).
// Pure functions over an already-loaded JournalEntry, no EF dependency — same
// "domain validator, caller does the DB lookups and SaveChanges" shape as
// Pako.Domain.Ledger.PostingRuleValidator and Pako.Domain.Reconciliation.ReconciliationValidator.
public static class HashChain
{
    // The first entry ever secured in a (company, journal) chain has no real predecessor.
    public const string GenesisHash = "";

    // Canonical fields only: CompanyId, JournalId, Date, SequenceNumber, and each line's
    // AccountId/Debit/Credit — per ARCHITECTURE.md's own stated intent for what this hashes.
    // Lines are ordered by Id (stable, not insertion/load order) so the hash is reproducible
    // regardless of how EF happens to have loaded the collection.
    public static string CanonicalRecord(JournalEntry entry) => string.Join('|',
        entry.CompanyId, entry.JournalId, entry.Date.ToString("yyyy-MM-dd"), entry.SequenceNumber,
        string.Join(';', entry.Lines.OrderBy(l => l.Id).Select(l => $"{l.AccountId}:{l.Debit}:{l.Credit}")));

    public static string ComputeEntryHash(string previousHash, JournalEntry entry)
    {
        var bytes = Encoding.UTF8.GetBytes(previousHash + CanonicalRecord(entry));
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}
