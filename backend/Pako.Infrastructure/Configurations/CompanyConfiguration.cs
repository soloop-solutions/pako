using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class CompanyConfiguration : IEntityTypeConfiguration<Company>
{
    public void Configure(EntityTypeBuilder<Company> builder)
    {
        builder.ToTable("companies");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Name).IsRequired().HasMaxLength(256);
        builder.HasOne<Firm>().WithMany().HasForeignKey(c => c.FirmId).OnDelete(DeleteBehavior.SetNull);

        builder.Property(c => c.FunctionalCurrency).IsRequired().HasMaxLength(3).HasDefaultValue("EUR");
        builder.Property(c => c.EnabledProfiles).HasDefaultValue(CompanyProfile.Core);
        builder.Property(c => c.IsVatRegistered).HasDefaultValue(true);
        builder.Property(c => c.IsArchived).HasDefaultValue(false);

        // Profile fields
        builder.Property(c => c.TradingName).HasMaxLength(256);
        builder.Property(c => c.BusinessNumber).HasMaxLength(50);
        builder.Property(c => c.FiscalNumber).HasMaxLength(50);
        builder.Property(c => c.VatNumber).HasMaxLength(50);
        builder.Property(c => c.BusinessActivity).HasMaxLength(256);
        builder.Property(c => c.Description).HasMaxLength(2000);

        // Address
        builder.Property(c => c.Country).HasMaxLength(100);
        builder.Property(c => c.Municipality).HasMaxLength(256);
        builder.Property(c => c.StreetAddress).HasMaxLength(512);
        builder.Property(c => c.PostalCode).HasMaxLength(20);
        builder.Property(c => c.AddressLine2).HasMaxLength(512);

        // Contact
        builder.Property(c => c.Email).HasMaxLength(256);
        builder.Property(c => c.Phone).HasMaxLength(50);
        builder.Property(c => c.Website).HasMaxLength(256);

        // Banking
        builder.Property(c => c.BankName).HasMaxLength(256);
        builder.Property(c => c.BankAccountHolder).HasMaxLength(256);
        builder.Property(c => c.Iban).HasMaxLength(50);
        builder.Property(c => c.SwiftBic).HasMaxLength(20);

        // Document
        builder.Property(c => c.DocumentFooter).HasMaxLength(2000);
        builder.Property(c => c.PaymentInstructions).HasMaxLength(2000);
    }
}
