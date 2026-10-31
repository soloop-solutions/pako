using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;

namespace Pako.Infrastructure.Configurations;

// docs/INVENTORY_PLAN.md. Quantities numeric(18,4), unit costs numeric(18,6), values numeric(18,2).
public class ItemCategoryConfiguration : IEntityTypeConfiguration<ItemCategory>
{
    public void Configure(EntityTypeBuilder<ItemCategory> builder)
    {
        builder.ToTable("item_categories");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Name).IsRequired().HasMaxLength(120);
        builder.HasIndex(c => new { c.CompanyId, c.Name }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class WarehouseConfiguration : IEntityTypeConfiguration<Warehouse>
{
    public void Configure(EntityTypeBuilder<Warehouse> builder)
    {
        builder.ToTable("warehouses");
        builder.HasKey(w => w.Id);
        builder.Property(w => w.Code).IsRequired().HasMaxLength(20);
        builder.Property(w => w.Name).IsRequired().HasMaxLength(120);
        builder.Property(w => w.Address).HasMaxLength(256);
        builder.HasIndex(w => new { w.CompanyId, w.Code }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(w => w.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class StockLocationConfiguration : IEntityTypeConfiguration<StockLocation>
{
    public void Configure(EntityTypeBuilder<StockLocation> builder)
    {
        builder.ToTable("stock_locations");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Name).IsRequired().HasMaxLength(120);
        builder.Property(l => l.Usage).HasConversion<string>().HasMaxLength(16);
        builder.Ignore(l => l.IsStock);
        builder.HasIndex(l => new { l.CompanyId, l.Usage, l.WarehouseId });
        builder.HasOne<Company>().WithMany().HasForeignKey(l => l.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Warehouse>().WithMany().HasForeignKey(l => l.WarehouseId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class StockSettingsConfiguration : IEntityTypeConfiguration<StockSettings>
{
    public void Configure(EntityTypeBuilder<StockSettings> builder)
    {
        builder.ToTable("stock_settings");
        builder.HasKey(s => s.CompanyId);
        builder.Property(s => s.CostMethod).HasConversion<string>().HasMaxLength(16);
        builder.Property(s => s.NegativeStock).HasConversion<string>().HasMaxLength(8);
        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Warehouse>().WithMany().HasForeignKey(s => s.DefaultWarehouseId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class StockMoveConfiguration : IEntityTypeConfiguration<StockMove>
{
    public void Configure(EntityTypeBuilder<StockMove> builder)
    {
        builder.ToTable("stock_moves");
        builder.HasKey(m => m.Id);
        // Always increasing, assigned by the database: orders moves that share a date.
        builder.Property(m => m.Sequence).UseIdentityAlwaysColumn();
        builder.Property(m => m.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(m => m.SourceType).HasConversion<string>().HasMaxLength(16);
        builder.Property(m => m.Reference).HasMaxLength(64);
        builder.Property(m => m.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(m => m.QtyAfter).HasColumnType("numeric(18,4)");
        builder.Property(m => m.UnitCost).HasColumnType("numeric(18,6)");
        builder.Property(m => m.AvgCostAfter).HasColumnType("numeric(18,6)");
        builder.Property(m => m.Value).HasColumnType("numeric(18,2)");
        builder.Property(m => m.ValueDelta).HasColumnType("numeric(18,2)");
        builder.Property(m => m.ValueAfter).HasColumnType("numeric(18,2)");
        builder.Property(m => m.Correction).HasColumnType("numeric(18,2)");
        // The item card and every replay read moves of one item in (date, sequence) order.
        builder.HasIndex(m => new { m.CompanyId, m.ItemId, m.Date, m.Sequence });
        builder.HasIndex(m => new { m.SourceType, m.SourceId });
        builder.HasOne<Company>().WithMany().HasForeignKey(m => m.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(m => m.ItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StockLocation>().WithMany().HasForeignKey(m => m.FromLocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StockLocation>().WithMany().HasForeignKey(m => m.ToLocationId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class StockBalanceConfiguration : IEntityTypeConfiguration<StockBalance>
{
    public void Configure(EntityTypeBuilder<StockBalance> builder)
    {
        builder.ToTable("stock_balances");
        builder.HasKey(b => new { b.ItemId, b.LocationId });
        builder.Property(b => b.Quantity).HasColumnType("numeric(18,4)");
        builder.HasIndex(b => new { b.CompanyId, b.LocationId });
        builder.HasOne<Item>().WithMany().HasForeignKey(b => b.ItemId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<StockLocation>().WithMany().HasForeignKey(b => b.LocationId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class ItemCostConfiguration : IEntityTypeConfiguration<ItemCost>
{
    public void Configure(EntityTypeBuilder<ItemCost> builder)
    {
        builder.ToTable("item_costs");
        builder.HasKey(c => c.ItemId);
        builder.Property(c => c.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(c => c.AverageCost).HasColumnType("numeric(18,6)");
        builder.Property(c => c.Value).HasColumnType("numeric(18,2)");
        builder.HasIndex(c => c.CompanyId);
        builder.HasOne<Item>().WithMany().HasForeignKey(c => c.ItemId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class StockDocumentConfiguration : IEntityTypeConfiguration<StockDocument>
{
    public void Configure(EntityTypeBuilder<StockDocument> builder)
    {
        builder.ToTable("stock_documents");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Type).HasConversion<string>().HasMaxLength(16);
        builder.Property(d => d.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(d => d.Reason).HasConversion<string>().HasMaxLength(16);
        builder.Property(d => d.Number).HasMaxLength(64);
        builder.Property(d => d.Notes).HasMaxLength(2000);
        builder.Ignore(d => d.IsPosted);
        builder.HasIndex(d => new { d.CompanyId, d.Type, d.Date });
        builder.HasIndex(d => new { d.CompanyId, d.Number }).IsUnique().HasFilter("\"Number\" IS NOT NULL");
        builder.HasMany(d => d.Lines).WithOne(l => l.StockDocument).HasForeignKey(l => l.StockDocumentId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Warehouse>().WithMany().HasForeignKey(d => d.WarehouseId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Warehouse>().WithMany().HasForeignKey(d => d.DestinationWarehouseId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class StockDocumentLineConfiguration : IEntityTypeConfiguration<StockDocumentLine>
{
    public void Configure(EntityTypeBuilder<StockDocumentLine> builder)
    {
        builder.ToTable("stock_document_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.BookQuantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.Difference).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitCost).HasColumnType("numeric(18,6)");
        builder.Property(l => l.Note).HasMaxLength(500);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}
