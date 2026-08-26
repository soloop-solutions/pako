using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Tax;

namespace Pako.Infrastructure.Configurations;

public class TaxDefinitionConfiguration : IEntityTypeConfiguration<TaxDefinition>
{
    public void Configure(EntityTypeBuilder<TaxDefinition> builder)
    {
        builder.ToTable("tax_definitions");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).IsRequired().HasMaxLength(256);
        builder.Property(t => t.Rate).HasColumnType("numeric(5,4)");
        builder.HasIndex(t => new { t.CompanyId, t.Name }).IsUnique();
        builder.HasMany(t => t.RepartitionLines)
            .WithOne(r => r.TaxDefinition)
            .HasForeignKey(r => r.TaxDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
