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
    }
}
