using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Ledger;

namespace Pako.Infrastructure.Configurations;

public class JournalEntryLineConfiguration : IEntityTypeConfiguration<JournalEntryLine>
{
    public void Configure(EntityTypeBuilder<JournalEntryLine> builder)
    {
        builder.ToTable("journal_entry_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Debit).HasColumnType("numeric(18,2)");
        builder.Property(l => l.Credit).HasColumnType("numeric(18,2)");
        builder.Property(l => l.Description).HasMaxLength(512);
        builder.HasIndex(l => l.AccountId);

        builder.Property(l => l.OriginalCurrency).HasMaxLength(3);
        builder.Property(l => l.OriginalAmount).HasColumnType("numeric(18,2)");
        builder.Property(l => l.ExchangeRate).HasColumnType("numeric(18,6)");

        // B14: a plain Dictionary property needs an explicit converter + value comparer to map
        // to jsonb — EF has no built-in JSON-column support for a bare dictionary property (only
        // for owned entity types), and without the comparer EF can't detect an in-place mutation
        // of the dictionary (e.g. someone adding a key) since it isn't a reference change.
        builder.Property(l => l.AnalyticDistribution)
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                v => string.IsNullOrEmpty(v) ? null : JsonSerializer.Deserialize<Dictionary<Guid, decimal>>(v, (JsonSerializerOptions?)null))
            .HasColumnType("jsonb")
            .Metadata.SetValueComparer(new ValueComparer<Dictionary<Guid, decimal>?>(
                (a, b) => (a ?? new Dictionary<Guid, decimal>()).SequenceEqual(b ?? new Dictionary<Guid, decimal>()),
                d => (d ?? new Dictionary<Guid, decimal>()).Aggregate(0, (hash, kv) => HashCode.Combine(hash, kv.Key, kv.Value)),
                d => d == null ? null : new Dictionary<Guid, decimal>(d)));
    }
}
