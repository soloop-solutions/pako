using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class PartnerConfiguration : IEntityTypeConfiguration<Partner>
{
    public void Configure(EntityTypeBuilder<Partner> builder)
    {
        builder.ToTable("partners");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Name).IsRequired().HasMaxLength(256);
        builder.Property(p => p.TaxNumber).HasMaxLength(64);
        builder.Property(p => p.FiscalNumber).HasMaxLength(64);
        builder.Property(p => p.IsVatRegistered).HasDefaultValue(false);
        builder.Property(p => p.CreditLimit).HasColumnType("numeric(18,2)");
        builder.HasIndex(p => p.CompanyId);
        builder.HasIndex(p => new { p.CompanyId, p.EmployeeId }).IsUnique().HasFilter("\"EmployeeId\" IS NOT NULL");
        builder.HasIndex(p => new { p.CompanyId, p.TaxNumber })
            .IsUnique()
            .HasFilter("\"TaxNumber\" IS NOT NULL")
            .HasDatabaseName("IX_partners_CompanyId_TaxNumber_Unique");
    }
}
