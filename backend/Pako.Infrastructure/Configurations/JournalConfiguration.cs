using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Ledger;

namespace Pako.Infrastructure.Configurations;

public class JournalConfiguration : IEntityTypeConfiguration<Journal>
{
    public void Configure(EntityTypeBuilder<Journal> builder)
    {
        builder.ToTable("journals");
        builder.HasKey(j => j.Id);
        builder.Property(j => j.Code).IsRequired().HasMaxLength(16);
        builder.Property(j => j.Name).IsRequired().HasMaxLength(256);
        builder.HasIndex(j => new { j.CompanyId, j.Code }).IsUnique();
    }
}
