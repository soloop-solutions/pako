using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class PayslipLineConfiguration : IEntityTypeConfiguration<PayslipLine>
{
    public void Configure(EntityTypeBuilder<PayslipLine> builder)
    {
        builder.ToTable("payslip_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.GrossSalary).HasColumnType("numeric(18,2)");
        builder.Property(l => l.PitAmount).HasColumnType("numeric(18,2)");
        builder.Property(l => l.EmployeePensionAmount).HasColumnType("numeric(18,2)");
        builder.Property(l => l.EmployerPensionAmount).HasColumnType("numeric(18,2)");
        builder.Property(l => l.NetPay).HasColumnType("numeric(18,2)");
        builder.HasIndex(l => l.EmployeeId);
    }
}
