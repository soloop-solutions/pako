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
        builder.Property(i => i.DefaultUnitPrice).HasColumnType("numeric(18,2)");
        builder.HasMany(i => i.Barcodes)
            .WithOne(b => b.Item)
            .HasForeignKey(b => b.ItemId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(i => new { i.CompanyId, i.Code }).IsUnique();
        // docs/INVENTORY_PLAN.md
        builder.Property(i => i.MinimumStock).HasColumnType("numeric(18,4)");
        builder.Property(i => i.PurchaseUnit).HasMaxLength(32);
        builder.Property(i => i.PurchaseUnitFactor).HasColumnType("numeric(18,4)");
        builder.Property(i => i.SalesUnit).HasMaxLength(32);
        builder.Property(i => i.SalesUnitFactor).HasColumnType("numeric(18,4)");
        builder.Property(i => i.Plu).HasMaxLength(6);
        builder.HasIndex(i => new { i.CompanyId, i.Plu }).IsUnique().HasFilter("\"Plu\" IS NOT NULL");
        builder.HasOne<Item>().WithMany().HasForeignKey(i => i.DepositItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Item>().WithMany().HasForeignKey(i => i.VariantOfItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Pako.Domain.Pos.ProductionCenter>().WithMany().HasForeignKey(i => i.ProductionCenterId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Item>().WithMany().HasForeignKey(i => i.PackageServiceItemId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(i => i.AtcCode).HasMaxLength(10);
        builder.Property(i => i.ActiveIngredient).HasMaxLength(200);
        builder.Property(i => i.MaxRetailPrice).HasColumnType("numeric(18,4)");
        builder.Property(i => i.AgencyCommissionPercent).HasColumnType("numeric(5,2)");
        builder.HasOne<Partner>().WithMany().HasForeignKey(i => i.AgencyPartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Pako.Domain.Inventory.ItemCategory>().WithMany().HasForeignKey(i => i.CategoryId).OnDelete(DeleteBehavior.SetNull);
    }
}
