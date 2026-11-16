using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Pako.Domain.Shared;

public static class AuditHashChain
{
    public const string GenesisHash = "";

    public static DateTime TruncateToMicroseconds(DateTime value) =>
        new(value.Ticks - value.Ticks % 10, DateTimeKind.Utc);

    public static string CanonicalRecord(AuditEntry e) => string.Join('|',
        e.CompanyId, e.SequenceNumber?.ToString(CultureInfo.InvariantCulture), e.Id, e.EntityType, e.EntityId, e.Action,
        e.UserId, e.OccurredAtUtc.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff", CultureInfo.InvariantCulture),
        e.Changes, e.IpAddress, e.RequestId, e.SourceDocumentId);

    public static string ComputeEntryHash(string previousHash, AuditEntry entry)
    {
        var bytes = Encoding.UTF8.GetBytes(previousHash + CanonicalRecord(entry));
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}
