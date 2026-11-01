using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class CompanyBankAccountConfiguration : IEntityTypeConfiguration<CompanyBankAccount>
{
    public void Configure(EntityTypeBuilder<CompanyBankAccount> builder)
    {
        builder.ToTable("company_bank_accounts");
        builder.HasKey(b => b.Id);
        builder.HasOne<Company>().WithMany().HasForeignKey(b => b.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.Property(b => b.BankName).IsRequired().HasMaxLength(256);
        builder.Property(b => b.AccountHolder).HasMaxLength(256);
        builder.Property(b => b.Iban).HasMaxLength(50);
        builder.Property(b => b.SwiftBic).HasMaxLength(20);
        builder.Property(b => b.IsDefault).HasDefaultValue(false);

        builder.HasIndex(b => new { b.CompanyId, b.SortOrder });
    }
}
