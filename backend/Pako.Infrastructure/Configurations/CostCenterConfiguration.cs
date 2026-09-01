using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;

namespace Pako.Infrastructure.Configurations;

public class CostCenterConfiguration : IEntityTypeConfiguration<CostCenter>
{
    public void Configure(EntityTypeBuilder<CostCenter> builder)
    {
        builder.ToTable("cost_centers");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Code).IsRequired().HasMaxLength(16);
        builder.Property(c => c.Name).IsRequired().HasMaxLength(256);
        builder.Property(c => c.NameEn).IsRequired().HasMaxLength(256);
        builder.Property(c => c.Profile).HasDefaultValue(CompanyProfile.None);
        builder.HasIndex(c => new { c.CompanyId, c.Code }).IsUnique();
    }
}
