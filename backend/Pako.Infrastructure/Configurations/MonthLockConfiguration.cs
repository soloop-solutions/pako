using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class MonthLockConfiguration : IEntityTypeConfiguration<MonthLock>
{
    public void Configure(EntityTypeBuilder<MonthLock> builder)
    {
        builder.ToTable("month_locks");
        builder.HasKey(e => e.Id);
        builder.HasIndex(e => new { e.CompanyId, e.Year, e.Month }).IsUnique();
        builder.Property(e => e.UnlockReason).HasMaxLength(512);
    }
}

public class MonthLockEventConfiguration : IEntityTypeConfiguration<MonthLockEvent>
{
    public void Configure(EntityTypeBuilder<MonthLockEvent> builder)
    {
        builder.ToTable("month_lock_events");
        builder.HasKey(e => e.Id);
        builder.HasIndex(e => new { e.CompanyId, e.Year });
        builder.Property(e => e.Reason).HasMaxLength(512);
    }
}
