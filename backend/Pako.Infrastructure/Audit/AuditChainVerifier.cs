using Microsoft.EntityFrameworkCore;
using Pako.Domain.Shared;

namespace Pako.Infrastructure.Audit;

public record AuditChainResult(
    bool Valid, int CheckedCount, int UnchainedCount,
    long? FirstBrokenSequence, Guid? FirstBrokenId, string? Reason);

public static class AuditChainVerifier
{
    public const string ReasonSequenceGap = "SequenceGap";
    public const string ReasonPrevHashMismatch = "PrevHashMismatch";
    public const string ReasonEntryHashMismatch = "EntryHashMismatch";

    public static async Task<AuditChainResult> VerifyAsync(
        PakoDbContext db, Guid companyId, CancellationToken cancellationToken = default)
    {
        var unchained = await db.AuditEntries.AsNoTracking()
            .CountAsync(a => a.CompanyId == companyId && a.SequenceNumber == null, cancellationToken);

        var checkedCount = 0;
        long expected = 1;
        var previousHash = AuditHashChain.GenesisHash;

        var rows = db.AuditEntries.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.SequenceNumber != null)
            .OrderBy(a => a.SequenceNumber)
            .AsAsyncEnumerable();

        await foreach (var row in rows.WithCancellation(cancellationToken))
        {
            string? reason = null;
            if (row.SequenceNumber != expected)
            {
                reason = ReasonSequenceGap;
            }
            else if (row.PrevHash != previousHash)
            {
                reason = ReasonPrevHashMismatch;
            }
            else if (row.EntryHash != AuditHashChain.ComputeEntryHash(previousHash, row))
            {
                reason = ReasonEntryHashMismatch;
            }

            if (reason is not null)
            {
                return new AuditChainResult(false, checkedCount, unchained, row.SequenceNumber, row.Id, reason);
            }

            checkedCount++;
            expected++;
            previousHash = row.EntryHash!;
        }

        return new AuditChainResult(true, checkedCount, unchained, null, null, null);
    }
}
