using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class EmployeeConfiguration : IEntityTypeConfiguration<Employee>
{
    public void Configure(EntityTypeBuilder<Employee> builder)
    {
        builder.ToTable("employees");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Name).IsRequired().HasMaxLength(256);
        builder.Property(e => e.FirstName).HasMaxLength(128);
        builder.Property(e => e.LastName).HasMaxLength(128);
        builder.Property(e => e.PersonalNumber).HasMaxLength(16);
        builder.Property(e => e.Email).HasMaxLength(256);
        builder.Property(e => e.Phone).HasMaxLength(64);
        builder.Property(e => e.Address).HasMaxLength(512);
        builder.Property(e => e.JobTitle).HasMaxLength(128);
        builder.Property(e => e.Iban).HasMaxLength(34);
        builder.Property(e => e.BankName).HasMaxLength(128);
        builder.Property(e => e.MonthlyGrossSalary).HasColumnType("numeric(18,2)");
        builder.Property(e => e.IsPrimaryEmployer).HasDefaultValue(true);
        builder.Property(e => e.PensionExempt).HasDefaultValue(false);
        builder.HasIndex(e => e.CompanyId);
        builder.HasIndex(e => e.DepartmentId);
        builder.HasIndex(e => new { e.CompanyId, e.UserId }).IsUnique().HasFilter("\"UserId\" IS NOT NULL");
        builder.HasIndex(e => new { e.CompanyId, e.PersonalNumber }).IsUnique().HasFilter("\"PersonalNumber\" IS NOT NULL");
    }
}
