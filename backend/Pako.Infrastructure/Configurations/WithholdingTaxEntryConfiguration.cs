using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Tax;

namespace Pako.Infrastructure.Configurations;

public class WithholdingTaxEntryConfiguration : IEntityTypeConfiguration<WithholdingTaxEntry>
{
    public void Configure(EntityTypeBuilder<WithholdingTaxEntry> builder)
    {
        builder.ToTable("withholding_tax_entries");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.PersonalNumber).IsRequired().HasMaxLength(50);
        builder.Property(e => e.Name).IsRequired().HasMaxLength(256);
        builder.Property(e => e.Country).IsRequired().HasMaxLength(100);
        builder.Property(e => e.GrossInterest).HasColumnType("numeric(18,2)");
        builder.Property(e => e.PropertyRights).HasColumnType("numeric(18,2)");
        builder.Property(e => e.LotteryWinnings).HasColumnType("numeric(18,2)");
        builder.Property(e => e.GrossRent).HasColumnType("numeric(18,2)");
        builder.Property(e => e.NonResidentEntertainer).HasColumnType("numeric(18,2)");
        builder.Property(e => e.NonResidentServices).HasColumnType("numeric(18,2)");
        builder.Property(e => e.NonEntrepreneur).HasColumnType("numeric(18,2)");
        builder.Property(e => e.RentalAreaM2).HasColumnType("numeric(18,2)");
        builder.Property(e => e.MonthlyGrossRent).HasColumnType("numeric(18,2)");
        builder.HasIndex(e => new { e.CompanyId, e.Year });
    }
}
