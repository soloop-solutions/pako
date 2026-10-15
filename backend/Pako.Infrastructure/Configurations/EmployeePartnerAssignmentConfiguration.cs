using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class EmployeePartnerAssignmentConfiguration : IEntityTypeConfiguration<EmployeePartnerAssignment>
{
    public void Configure(EntityTypeBuilder<EmployeePartnerAssignment> builder)
    {
        builder.ToTable("employee_partner_assignments");
        builder.HasKey(a => a.Id);
        builder.HasOne<Employee>().WithMany().HasForeignKey(a => a.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(a => a.PartnerId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(a => new { a.EmployeeId, a.PartnerId }).IsUnique();
        builder.HasIndex(a => new { a.CompanyId, a.PartnerId });
    }
}
