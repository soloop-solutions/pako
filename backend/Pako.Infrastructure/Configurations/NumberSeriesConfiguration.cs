using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class NumberSeriesConfiguration : IEntityTypeConfiguration<NumberSeries>
{
    public void Configure(EntityTypeBuilder<NumberSeries> builder)
    {
        builder.ToTable("number_series");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.DocumentType).IsRequired().HasMaxLength(32);
        builder.Property(s => s.Pattern).IsRequired().HasMaxLength(64);
        builder.Property(s => s.NextValue).HasDefaultValue(1);
        builder.HasIndex(s => new { s.CompanyId, s.DocumentType, s.Year }).IsUnique();
    }
}
