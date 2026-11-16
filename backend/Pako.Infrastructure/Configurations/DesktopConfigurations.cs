using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Desktop;
using Pako.Infrastructure.Desktop;

namespace Pako.Infrastructure.Configurations;

public class DesktopLicenseRecordConfiguration : IEntityTypeConfiguration<DesktopLicenseRecord>
{
    public void Configure(EntityTypeBuilder<DesktopLicenseRecord> builder)
    {
        builder.ToTable("desktop_license_records");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.LicenseKey).HasMaxLength(4096);
    }
}

public class AdminRecoveryRecordConfiguration : IEntityTypeConfiguration<AdminRecoveryRecord>
{
    public void Configure(EntityTypeBuilder<AdminRecoveryRecord> builder)
    {
        builder.ToTable("admin_recovery_records");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.UserId).IsRequired().HasMaxLength(450);
        builder.Property(r => r.CodeHash).IsRequired().HasMaxLength(256);
        builder.HasIndex(r => r.UserId);
    }
}
