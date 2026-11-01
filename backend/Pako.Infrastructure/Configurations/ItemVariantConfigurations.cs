using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;

namespace Pako.Infrastructure.Configurations;

// docs/POS_PLAN.md P2: item variants (attributes and their values) and serial numbers.
public class ItemAttributeConfiguration : IEntityTypeConfiguration<ItemAttribute>
{
    public void Configure(EntityTypeBuilder<ItemAttribute> builder)
    {
        builder.ToTable("item_attributes");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Name).IsRequired().HasMaxLength(60);
        builder.HasIndex(a => new { a.CompanyId, a.Name }).IsUnique();
        builder.HasMany(a => a.Values).WithOne().HasForeignKey(v => v.AttributeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ItemAttributeValueConfiguration : IEntityTypeConfiguration<ItemAttributeValue>
{
    public void Configure(EntityTypeBuilder<ItemAttributeValue> builder)
    {
        builder.ToTable("item_attribute_values");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.Value).IsRequired().HasMaxLength(60);
        builder.HasIndex(v => new { v.AttributeId, v.Value }).IsUnique();
    }
}

public class ItemVariantValueConfiguration : IEntityTypeConfiguration<ItemVariantValue>
{
    public void Configure(EntityTypeBuilder<ItemVariantValue> builder)
    {
        builder.ToTable("item_variant_values");
        builder.HasKey(v => new { v.ItemId, v.AttributeValueId });
        builder.HasOne<Item>().WithMany().HasForeignKey(v => v.ItemId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ItemAttributeValue>().WithMany().HasForeignKey(v => v.AttributeValueId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class ItemSerialConfiguration : IEntityTypeConfiguration<ItemSerial>
{
    public void Configure(EntityTypeBuilder<ItemSerial> builder)
    {
        builder.ToTable("item_serials");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Serial).IsRequired().HasMaxLength(64);
        builder.Property(s => s.Status).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(s => new { s.CompanyId, s.ItemId, s.Serial }).IsUnique();
        builder.HasIndex(s => new { s.CompanyId, s.Serial });
        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(s => s.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class RecipeLineConfiguration : IEntityTypeConfiguration<RecipeLine>
{
    public void Configure(EntityTypeBuilder<RecipeLine> builder)
    {
        builder.ToTable("item_recipe_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.WastePercent).HasColumnType("numeric(9,4)");
        builder.HasIndex(l => l.ItemId);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.IngredientItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

