using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class AccountLockExceptionConfiguration : IEntityTypeConfiguration<AccountLockException>
{
    public void Configure(EntityTypeBuilder<AccountLockException> builder)
    {
        builder.ToTable("account_lock_exceptions");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Reason).IsRequired().HasMaxLength(512);
        builder.HasIndex(e => new { e.CompanyId, e.UserId, e.LockDateField });
    }
}
