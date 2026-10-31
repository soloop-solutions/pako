using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class ExpenseClaimConfiguration : IEntityTypeConfiguration<ExpenseClaim>
{
    public void Configure(EntityTypeBuilder<ExpenseClaim> builder)
    {
        builder.ToTable("expense_claims");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Title).IsRequired().HasMaxLength(200);
        builder.Property(c => c.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(c => c.DecisionNote).HasMaxLength(512);
        builder.Ignore(c => c.Total);
        builder.HasOne<Employee>().WithMany().HasForeignKey(c => c.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(c => c.Lines).WithOne().HasForeignKey(l => l.ExpenseClaimId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(c => new { c.CompanyId, c.State });
        builder.HasIndex(c => c.EmployeeId);
        builder.HasIndex(c => c.BillId);
    }
}

public class ExpenseClaimLineConfiguration : IEntityTypeConfiguration<ExpenseClaimLine>
{
    public void Configure(EntityTypeBuilder<ExpenseClaimLine> builder)
    {
        builder.ToTable("expense_claim_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).IsRequired().HasMaxLength(256);
        builder.Property(l => l.Amount).HasPrecision(18, 2);
        builder.Property(l => l.SupplierName).HasMaxLength(200);
        builder.Property(l => l.SupplierFiscalNumber).HasMaxLength(32);
    }
}

public class TimeEntryConfiguration : IEntityTypeConfiguration<TimeEntry>
{
    public void Configure(EntityTypeBuilder<TimeEntry> builder)
    {
        builder.ToTable("time_entries");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Hours).HasPrecision(5, 2);
        builder.Property(t => t.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(t => t.Source).HasConversion<string>().HasMaxLength(16);
        builder.Property(t => t.Note).HasMaxLength(256);
        builder.HasOne<Employee>().WithMany().HasForeignKey(t => t.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(t => new { t.CompanyId, t.Date });
        builder.HasIndex(t => new { t.EmployeeId, t.Date });
    }
}
