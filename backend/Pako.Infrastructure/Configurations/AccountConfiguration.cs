using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
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
    }
}
