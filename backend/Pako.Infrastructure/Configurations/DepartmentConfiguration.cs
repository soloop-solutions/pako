using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Hr;

namespace Pako.Infrastructure.Configurations;

public class DepartmentConfiguration : IEntityTypeConfiguration<Department>
{
    public void Configure(EntityTypeBuilder<Department> builder)
    {
        builder.ToTable("departments");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Code).IsRequired().HasMaxLength(16);
        builder.Property(d => d.Name).IsRequired().HasMaxLength(256);
        builder.Property(d => d.SalesAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(d => d.PurchasesAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(d => d.PartnersAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(d => d.AccountingAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(d => d.ReportsAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(d => d.HrAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(d => d.PartnerScope).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(d => new { d.CompanyId, d.Code }).IsUnique();
    }
}
