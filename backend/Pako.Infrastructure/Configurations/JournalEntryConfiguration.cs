using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Ledger;

namespace Pako.Infrastructure.Configurations;

public class JournalEntryConfiguration : IEntityTypeConfiguration<JournalEntry>
{
    public void Configure(EntityTypeBuilder<JournalEntry> builder)
    {
        builder.ToTable("journal_entries");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(e => e.Reference).HasMaxLength(256);
        builder.Property(e => e.SequenceNumber).HasMaxLength(64);
        builder.Property(e => e.EntryHash).HasMaxLength(128);
        builder.Property(e => e.PrevHash).HasMaxLength(128);
        builder.HasMany(e => e.Lines)
            .WithOne(l => l.JournalEntry)
            .HasForeignKey(l => l.JournalEntryId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(e => new { e.CompanyId, e.JournalId, e.State });
    }
}
