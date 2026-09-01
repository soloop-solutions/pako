using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;

namespace Pako.Infrastructure.Configurations;

public class AccountConfiguration : IEntityTypeConfiguration<Account>
{
    public void Configure(EntityTypeBuilder<Account> builder)
    {
        builder.ToTable("accounts");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Code).IsRequired().HasMaxLength(32);
        builder.Property(a => a.Name).IsRequired().HasMaxLength(256);
        builder.HasIndex(a => new { a.CompanyId, a.Code }).IsUnique();

        builder.Property(a => a.NameSq).HasMaxLength(256);
        builder.Property(a => a.DefaultVatCode).HasMaxLength(16);
        builder.Property(a => a.CitLimitRule).HasMaxLength(512);
        builder.Property(a => a.Profiles).HasDefaultValue(CompanyProfile.None);
        builder.Property(a => a.IsPostable).HasDefaultValue(true);
        builder.Property(a => a.IsControl).HasDefaultValue(false);
        builder.Property(a => a.IsActive).HasDefaultValue(true);
    }
}
