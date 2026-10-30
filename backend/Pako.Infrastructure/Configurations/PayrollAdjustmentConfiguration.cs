using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class PayrollAdjustmentConfiguration : IEntityTypeConfiguration<PayrollAdjustment>
{
    public void Configure(EntityTypeBuilder<PayrollAdjustment> builder)
    {
        builder.ToTable("payroll_adjustments");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(a => a.CommissionBasisAmount).HasColumnType("numeric(18,2)");
        builder.HasOne<EmployeeLoan>().WithMany().HasForeignKey(a => a.EmployeeLoanId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => a.EmployeeLoanId);
        builder.HasIndex(a => a.ExpenseClaimId);
        builder.Property(a => a.Description).HasMaxLength(256);
        builder.Property(a => a.Hours).HasColumnType("numeric(8,2)");
        builder.Property(a => a.RateMultiplier).HasColumnType("numeric(6,4)");
        builder.Property(a => a.Amount).HasColumnType("numeric(18,2)");
        builder.HasOne<Employee>().WithMany().HasForeignKey(a => a.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => new { a.CompanyId, a.Period });
        builder.HasIndex(a => a.PayrollRunId);
    }
}
