using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class PayrollRunConfiguration : IEntityTypeConfiguration<PayrollRun>
{
    public void Configure(EntityTypeBuilder<PayrollRun> builder)
    {
        builder.ToTable("payroll_runs");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.Notes).HasMaxLength(1024);
        builder.Property(p => p.ParametersSnapshot).HasColumnType("jsonb");
        builder.HasMany(p => p.Lines)
            .WithOne(l => l.PayrollRun)
            .HasForeignKey(l => l.PayrollRunId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(p => new { p.CompanyId, p.State });
    }
}
