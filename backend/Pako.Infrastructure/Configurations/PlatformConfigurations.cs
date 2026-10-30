using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Platform;

namespace Pako.Infrastructure.Configurations;

public class AccountRequestConfiguration : IEntityTypeConfiguration<AccountRequest>
{
    public void Configure(EntityTypeBuilder<AccountRequest> builder)
    {
        builder.ToTable("account_requests");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.FullName).IsRequired().HasMaxLength(200);
        builder.Property(r => r.Email).IsRequired().HasMaxLength(256);
        builder.Property(r => r.Phone).HasMaxLength(50);
        builder.Property(r => r.FirmName).HasMaxLength(256);
        builder.Property(r => r.BusinessNumber).HasMaxLength(50);
        builder.Property(r => r.City).HasMaxLength(100);
        builder.Property(r => r.Message).HasMaxLength(2000);
        builder.Property(r => r.DecisionNote).HasMaxLength(1000);
        builder.Property(r => r.Status).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(r => new { r.Status, r.CreatedAt });
        builder.HasIndex(r => r.Email);
    }
}
