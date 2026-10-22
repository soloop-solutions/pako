using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class EmployeeContractConfiguration : IEntityTypeConfiguration<EmployeeContract>
{
    public void Configure(EntityTypeBuilder<EmployeeContract> builder)
    {
        builder.ToTable("employee_contracts");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.MonthlyGrossSalary).HasColumnType("numeric(18,2)");
        builder.Property(c => c.WeeklyHours).HasColumnType("numeric(5,2)");
        builder.Property(c => c.EmploymentType).HasConversion<string>().HasMaxLength(16);
        builder.Property(c => c.JobTitle).HasMaxLength(128);
        builder.Property(c => c.Notes).HasMaxLength(1024);
        builder.HasOne<Employee>().WithMany().HasForeignKey(c => c.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(c => new { c.EmployeeId, c.StartDate });
    }
}
