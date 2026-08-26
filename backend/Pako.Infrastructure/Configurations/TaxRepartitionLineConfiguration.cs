using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Tax;

namespace Pako.Infrastructure.Configurations;

public class TaxRepartitionLineConfiguration : IEntityTypeConfiguration<TaxRepartitionLine>
{
    public void Configure(EntityTypeBuilder<TaxRepartitionLine> builder)
    {
        builder.ToTable("tax_repartition_lines");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Percentage).HasColumnType("numeric(5,2)");
        builder.Property(r => r.Tag).HasMaxLength(64);
        builder.HasIndex(r => r.AccountId);
    }
}
