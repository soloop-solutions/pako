using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Bills;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class BillLineConfiguration : IEntityTypeConfiguration<BillLine>
{
    public void Configure(EntityTypeBuilder<BillLine> builder)
    {
        builder.ToTable("bill_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).HasMaxLength(512);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,2)");
        builder.Property(l => l.UnitName).HasMaxLength(32);
        builder.Property(l => l.LotNumber).HasMaxLength(64);
        builder.Property(l => l.UnitFactor).HasColumnType("numeric(18,4)").HasDefaultValue(1m);
        builder.HasIndex(l => l.ExpenseAccountId);
        builder.HasOne<Pako.Domain.Projects.CostCode>().WithMany().HasForeignKey(l => l.CostCodeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<PurchaseOrderLine>().WithMany().HasForeignKey(l => l.PurchaseOrderLineId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => l.PurchaseOrderLineId);
    }
}

// docs/INVENTORY_PLAN.md §12 P5.
public class PurchaseOrderConfiguration : IEntityTypeConfiguration<PurchaseOrder>
{
    public void Configure(EntityTypeBuilder<PurchaseOrder> builder)
    {
        builder.ToTable("purchase_orders");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(o => o.Number).HasMaxLength(64);
        builder.Property(o => o.VendorReference).HasMaxLength(128);
        builder.Property(o => o.Notes).HasMaxLength(2000);
        builder.HasIndex(o => new { o.CompanyId, o.State, o.Date });
        builder.HasIndex(o => new { o.CompanyId, o.Number }).IsUnique().HasFilter("\"Number\" IS NOT NULL");
        builder.HasMany(o => o.Lines).WithOne(l => l.PurchaseOrder).HasForeignKey(l => l.PurchaseOrderId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(o => o.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(o => o.PartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Pako.Domain.Inventory.Warehouse>().WithMany().HasForeignKey(o => o.WarehouseId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PurchaseOrderLineConfiguration : IEntityTypeConfiguration<PurchaseOrderLine>
{
    public void Configure(EntityTypeBuilder<PurchaseOrderLine> builder)
    {
        builder.ToTable("purchase_order_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).HasMaxLength(512);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,2)");
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}
