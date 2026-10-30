using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Notifications;

namespace Pako.Infrastructure.Configurations;

public class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("notifications");
        builder.HasKey(n => n.Id);
        builder.Property(n => n.RecipientEmail).IsRequired().HasMaxLength(256);
        builder.Property(n => n.Template).IsRequired().HasMaxLength(64);
        builder.Property(n => n.Culture).IsRequired().HasMaxLength(8);
        builder.Property(n => n.PayloadJson).IsRequired().HasColumnType("jsonb");
        builder.Property(n => n.AttachmentKind).HasMaxLength(32);
        builder.Property(n => n.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(n => n.LastError).HasMaxLength(1000);
        // The dispatcher's scan: pending rows that are due.
        builder.HasIndex(n => new { n.State, n.NextAttemptAt });
        builder.HasIndex(n => new { n.CompanyId, n.CreatedAt });
        builder.HasOne<Company>().WithMany().HasForeignKey(n => n.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class CompanyNotificationSettingConfiguration : IEntityTypeConfiguration<CompanyNotificationSetting>
{
    public void Configure(EntityTypeBuilder<CompanyNotificationSetting> builder)
    {
        builder.ToTable("company_notification_settings");
        builder.HasKey(s => new { s.CompanyId, s.Template });
        builder.Property(s => s.Template).HasMaxLength(64);
        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class JobLockConfiguration : IEntityTypeConfiguration<JobLock>
{
    public void Configure(EntityTypeBuilder<JobLock> builder)
    {
        builder.ToTable("job_locks");
        builder.HasKey(j => j.Name);
        builder.Property(j => j.Name).HasMaxLength(64);
    }
}

public class DashboardLayoutConfiguration : IEntityTypeConfiguration<DashboardLayout>
{
    public void Configure(EntityTypeBuilder<DashboardLayout> builder)
    {
        builder.ToTable("dashboard_layouts");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.WidgetsJson).IsRequired().HasColumnType("jsonb");
        builder.HasIndex(d => d.CompanyId).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}
