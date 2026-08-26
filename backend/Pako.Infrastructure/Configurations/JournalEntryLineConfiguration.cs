using Microsoft.EntityFrameworkCore;
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
    }
}
