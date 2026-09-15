using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Ledger;

namespace Pako.Infrastructure.Configurations;

public class AccountGroupConfiguration : IEntityTypeConfiguration<AccountGroup>
{
    public void Configure(EntityTypeBuilder<AccountGroup> builder)
    {
        builder.ToTable("account_groups");
        builder.HasKey(g => g.Id);
        builder.Property(g => g.Name).IsRequired().HasMaxLength(256);
        builder.Property(g => g.CodePrefixStart).IsRequired().HasMaxLength(32);
        builder.Property(g => g.CodePrefixEnd).IsRequired().HasMaxLength(32);
        builder.HasIndex(g => g.CompanyId);

        // Self-referencing, nullable: a Class-level row has no parent, a Group-level row points
        // to its Class-level row. No cascade delete — groups are seeded once and never deleted.
        builder.HasOne<AccountGroup>()
            .WithMany()
            .HasForeignKey(g => g.ParentGroupId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
