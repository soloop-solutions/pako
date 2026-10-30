using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class EmployeeLoanConfiguration : IEntityTypeConfiguration<EmployeeLoan>
{
    public void Configure(EntityTypeBuilder<EmployeeLoan> builder)
    {
        builder.ToTable("employee_loans");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(l => l.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(l => l.Principal).HasPrecision(18, 2);
        builder.Property(l => l.InstallmentAmount).HasPrecision(18, 2);
        builder.Property(l => l.Notes).HasMaxLength(512);
        builder.HasOne<Employee>().WithMany().HasForeignKey(l => l.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => new { l.CompanyId, l.State });
        builder.HasIndex(l => l.EmployeeId);
    }
}

public class CommissionPlanConfiguration : IEntityTypeConfiguration<CommissionPlan>
{
    public void Configure(EntityTypeBuilder<CommissionPlan> builder)
    {
        builder.ToTable("commission_plans");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Name).IsRequired().HasMaxLength(128);
        builder.Property(p => p.Basis).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.Rate).HasPrecision(9, 6);
        builder.Property(p => p.MinThreshold).HasPrecision(18, 2);
        builder.HasIndex(p => new { p.CompanyId, p.Name }).IsUnique();
    }
}

public class EmployeePartnerAssignmentPeriodConfiguration : IEntityTypeConfiguration<EmployeePartnerAssignmentPeriod>
{
    public void Configure(EntityTypeBuilder<EmployeePartnerAssignmentPeriod> builder)
    {
        builder.ToTable("employee_partner_assignment_periods");
        builder.HasKey(p => p.Id);
        builder.HasOne<Employee>().WithMany().HasForeignKey(p => p.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(p => new { p.CompanyId, p.PartnerId });
        builder.HasIndex(p => p.EmployeeId);
    }
}
