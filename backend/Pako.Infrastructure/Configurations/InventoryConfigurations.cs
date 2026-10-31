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
        builder.HasOne<Partner>().WithMany().HasForeignKey(d => d.PartnerId).OnDelete(DeleteBehavior.Restrict);
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
        builder.Property(l => l.AverageCost).HasColumnType("numeric(18,6)");
        builder.Property(l => l.AllowanceAfter).HasColumnType("numeric(18,2)");
        builder.Property(l => l.Amount).HasColumnType("numeric(18,2)");
        builder.HasOne<Pako.Domain.Bills.PurchaseOrderLine>().WithMany().HasForeignKey(l => l.PurchaseOrderLineId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(l => l.LotNumber).HasMaxLength(64);
        builder.Property(l => l.Note).HasMaxLength(500);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

// §12 P4 — price lists and price changes (Nivelim). Prices numeric(18,4): retail prices can carry
// fractions of a cent per unit (fuel, bulk goods).
public class PriceListConfiguration : IEntityTypeConfiguration<PriceList>
{
    public void Configure(EntityTypeBuilder<PriceList> builder)
    {
        builder.ToTable("price_lists");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Name).IsRequired().HasMaxLength(120);
        builder.HasIndex(p => new { p.CompanyId, p.Name }).IsUnique();
        // At most one list per warehouse, and one company-wide list.
        builder.HasIndex(p => new { p.CompanyId, p.WarehouseId }).IsUnique().AreNullsDistinct(false);
        builder.HasOne<Company>().WithMany().HasForeignKey(p => p.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Warehouse>().WithMany().HasForeignKey(p => p.WarehouseId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PriceListPriceConfiguration : IEntityTypeConfiguration<PriceListPrice>
{
    public void Configure(EntityTypeBuilder<PriceListPrice> builder)
    {
        builder.ToTable("price_list_prices");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Price).HasColumnType("numeric(18,4)");
        builder.HasIndex(p => new { p.PriceListId, p.ItemId, p.ValidFrom });
        builder.HasOne<PriceList>().WithMany().HasForeignKey(p => p.PriceListId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(p => p.ItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<PriceChange>().WithMany().HasForeignKey(p => p.PriceChangeId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PriceChangeConfiguration : IEntityTypeConfiguration<PriceChange>
{
    public void Configure(EntityTypeBuilder<PriceChange> builder)
    {
        builder.ToTable("price_changes");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(d => d.Number).HasMaxLength(64);
        builder.Property(d => d.Notes).HasMaxLength(2000);
        builder.Ignore(d => d.IsPosted);
        builder.HasIndex(d => new { d.CompanyId, d.Date });
        builder.HasIndex(d => new { d.CompanyId, d.Number }).IsUnique().HasFilter("\"Number\" IS NOT NULL");
        builder.HasMany(d => d.Lines).WithOne(l => l.PriceChange).HasForeignKey(l => l.PriceChangeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PriceList>().WithMany().HasForeignKey(d => d.PriceListId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PriceChangeLineConfiguration : IEntityTypeConfiguration<PriceChangeLine>
{
    public void Configure(EntityTypeBuilder<PriceChangeLine> builder)
    {
        builder.ToTable("price_change_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.NewPrice).HasColumnType("numeric(18,4)");
        builder.Property(l => l.OldPrice).HasColumnType("numeric(18,4)");
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.Difference).HasColumnType("numeric(18,2)");
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

// §12 P6 — bill lines matched against receipts (GRNI).
public class ReceiptMatchConfiguration : IEntityTypeConfiguration<ReceiptMatch>
{
    public void Configure(EntityTypeBuilder<ReceiptMatch> builder)
    {
        builder.ToTable("receipt_matches");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(m => m.Value).HasColumnType("numeric(18,2)");
        builder.HasIndex(m => m.ReceiptLineId);
        builder.HasIndex(m => m.BillId);
        builder.HasOne<StockDocumentLine>().WithMany().HasForeignKey(m => m.ReceiptLineId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Pako.Domain.Bills.Bill>().WithMany().HasForeignKey(m => m.BillId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(m => m.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

// §12 P8 — lots and expiry dates.
public class LotConfiguration : IEntityTypeConfiguration<Lot>
{
    public void Configure(EntityTypeBuilder<Lot> builder)
    {
        builder.ToTable("lots");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Number).IsRequired().HasMaxLength(64);
        builder.HasIndex(l => new { l.ItemId, l.Number }).IsUnique();
        builder.HasIndex(l => new { l.CompanyId, l.ExpiryDate });
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(l => l.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class LotBalanceConfiguration : IEntityTypeConfiguration<LotBalance>
{
    public void Configure(EntityTypeBuilder<LotBalance> builder)
    {
        builder.ToTable("lot_balances");
        builder.HasKey(b => new { b.LotId, b.LocationId });
        builder.Property(b => b.Quantity).HasColumnType("numeric(18,4)");
        builder.HasIndex(b => new { b.ItemId, b.LocationId });
        builder.HasOne<Lot>().WithMany().HasForeignKey(b => b.LotId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<StockLocation>().WithMany().HasForeignKey(b => b.LocationId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class StockMoveLotConfiguration : IEntityTypeConfiguration<StockMoveLot>
{
    public void Configure(EntityTypeBuilder<StockMoveLot> builder)
    {
        builder.ToTable("stock_move_lots");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Quantity).HasColumnType("numeric(18,4)");
        builder.HasIndex(m => m.StockMoveId);
        builder.HasIndex(m => m.LotId);
        builder.HasOne<StockMove>().WithMany().HasForeignKey(m => m.StockMoveId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Lot>().WithMany().HasForeignKey(m => m.LotId).OnDelete(DeleteBehavior.Restrict);
    }
}
