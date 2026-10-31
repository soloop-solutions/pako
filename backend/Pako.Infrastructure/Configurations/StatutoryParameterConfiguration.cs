using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Payroll;

namespace Pako.Infrastructure.Configurations;

public class StatutoryParameterConfiguration : IEntityTypeConfiguration<StatutoryParameter>
{
    public void Configure(EntityTypeBuilder<StatutoryParameter> builder)
    {
        builder.ToTable("statutory_parameters");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Key).IsRequired().HasMaxLength(64);
        builder.Property(p => p.Value).HasPrecision(18, 4);
        builder.Property(p => p.Source).HasMaxLength(256);
        builder.HasIndex(p => new { p.FirmId, p.Key, p.EffectiveFrom }).IsUnique();
        builder.HasOne<Pako.Domain.Companies.Firm>().WithMany().HasForeignKey(p => p.FirmId).OnDelete(DeleteBehavior.Cascade);
    }
}
