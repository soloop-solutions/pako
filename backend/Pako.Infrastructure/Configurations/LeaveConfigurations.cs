using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class LeaveTypeConfiguration : IEntityTypeConfiguration<LeaveType>
{
    public void Configure(EntityTypeBuilder<LeaveType> builder)
    {
        builder.ToTable("leave_types");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Code).IsRequired().HasMaxLength(16);
        builder.Property(t => t.Name).IsRequired().HasMaxLength(128);
        builder.Property(t => t.DefaultAnnualDays).HasColumnType("numeric(6,2)");
        builder.Property(t => t.PayPercent).HasColumnType("numeric(5,2)");
        builder.Property(t => t.CarryOverMaxDays).HasColumnType("numeric(6,2)");
        builder.HasIndex(t => new { t.CompanyId, t.Code }).IsUnique();
    }
}

public class LeaveAllocationConfiguration : IEntityTypeConfiguration<LeaveAllocation>
{
    public void Configure(EntityTypeBuilder<LeaveAllocation> builder)
    {
        builder.ToTable("leave_allocations");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Days).HasColumnType("numeric(6,2)");
        builder.Property(a => a.CarriedOverDays).HasColumnType("numeric(6,2)");
        builder.HasOne<Employee>().WithMany().HasForeignKey(a => a.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<LeaveType>().WithMany().HasForeignKey(a => a.LeaveTypeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => new { a.EmployeeId, a.LeaveTypeId, a.Year }).IsUnique();
    }
}

public class LeaveRequestConfiguration : IEntityTypeConfiguration<LeaveRequest>
{
    public void Configure(EntityTypeBuilder<LeaveRequest> builder)
    {
        builder.ToTable("leave_requests");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Days).HasColumnType("numeric(6,2)");
        builder.Property(r => r.Reason).HasMaxLength(512);
        builder.Property(r => r.State).HasConversion<string>().HasMaxLength(16);
        builder.HasOne<Employee>().WithMany().HasForeignKey(r => r.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<LeaveType>().WithMany().HasForeignKey(r => r.LeaveTypeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(r => new { r.CompanyId, r.State });
        builder.HasIndex(r => new { r.EmployeeId, r.StartDate });
    }
}

public class PublicHolidayConfiguration : IEntityTypeConfiguration<PublicHoliday>
{
    public void Configure(EntityTypeBuilder<PublicHoliday> builder)
    {
        builder.ToTable("public_holidays");
        builder.HasKey(h => h.Id);
        builder.Property(h => h.Name).IsRequired().HasMaxLength(128);
        builder.HasIndex(h => new { h.CompanyId, h.Date }).IsUnique();
    }
}

public class EmployeeProfileChangeConfiguration : IEntityTypeConfiguration<EmployeeProfileChange>
{
    public void Configure(EntityTypeBuilder<EmployeeProfileChange> builder)
    {
        builder.ToTable("employee_profile_changes");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.NewIban).IsRequired().HasMaxLength(34);
        builder.Property(c => c.NewBankName).HasMaxLength(128);
        builder.Property(c => c.PreviousIban).HasMaxLength(34);
        builder.Property(c => c.PreviousBankName).HasMaxLength(128);
        builder.Property(c => c.State).HasConversion<string>().HasMaxLength(16);
        builder.HasOne<Employee>().WithMany().HasForeignKey(c => c.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(c => new { c.CompanyId, c.State });
        // At most one open request per employee: a second one replaces the first (see MeController).
        builder.HasIndex(c => c.EmployeeId).IsUnique().HasFilter("\"State\" = 'Pending'");
    }
}
