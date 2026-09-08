using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class ItemConfiguration : IEntityTypeConfiguration<Item>
{
    public void Configure(EntityTypeBuilder<Item> builder)
    {
        builder.ToTable("items");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.Name).IsRequired().HasMaxLength(256);
        builder.Property(i => i.Unit).IsRequired().HasMaxLength(32);
        builder.HasMany(i => i.Barcodes)
            .WithOne(b => b.Item)
            .HasForeignKey(b => b.ItemId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(i => new { i.CompanyId, i.Code }).IsUnique();
    }
}
