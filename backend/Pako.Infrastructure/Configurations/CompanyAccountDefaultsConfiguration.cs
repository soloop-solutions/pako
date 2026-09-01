using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class CompanyAccountDefaultsConfiguration : IEntityTypeConfiguration<CompanyAccountDefaults>
{
    public void Configure(EntityTypeBuilder<CompanyAccountDefaults> builder)
    {
        builder.ToTable("company_account_defaults");
        builder.HasKey(d => d.Id);
        builder.HasIndex(d => d.CompanyId).IsUnique();
    }
}
