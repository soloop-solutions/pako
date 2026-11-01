using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;

namespace Pako.Infrastructure.Configurations;

// docs/POS_PLAN.md P6 — sales orders and van routes.
public class SalesOrderConfiguration : IEntityTypeConfiguration<SalesOrder>
{
    public void Configure(EntityTypeBuilder<SalesOrder> builder)
    {
        builder.ToTable("sales_orders");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(o => o.QuoteNumber).HasMaxLength(64);
        builder.Property(o => o.Number).HasMaxLength(64);
        builder.Property(o => o.CustomerReference).HasMaxLength(128);
        builder.Property(o => o.DeliveryAddress).HasMaxLength(500);
        builder.Property(o => o.Notes).HasMaxLength(2000);
        builder.Property(o => o.BlockOverrideReason).HasMaxLength(500);
        builder.HasIndex(o => new { o.CompanyId, o.State, o.Date });
        builder.HasIndex(o => new { o.CompanyId, o.Number }).IsUnique().HasFilter("\"Number\" IS NOT NULL");
        builder.HasIndex(o => new { o.CompanyId, o.QuoteNumber }).IsUnique().HasFilter("\"QuoteNumber\" IS NOT NULL");
        builder.HasMany(o => o.Lines).WithOne(l => l.SalesOrder).HasForeignKey(l => l.SalesOrderId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(o => o.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(o => o.PartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Warehouse>().WithMany().HasForeignKey(o => o.WarehouseId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RouteVisit>().WithMany().HasForeignKey(o => o.RouteVisitId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class SalesOrderLineConfiguration : IEntityTypeConfiguration<SalesOrderLine>
{
    public void Configure(EntityTypeBuilder<SalesOrderLine> builder)
    {
        builder.ToTable("sales_order_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).HasMaxLength(512);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitName).HasMaxLength(32);
        builder.Property(l => l.UnitFactor).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,4)");
        builder.Property(l => l.DiscountPercent).HasColumnType("numeric(5,2)");
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Pako.Domain.Tax.TaxDefinition>().WithMany().HasForeignKey(l => l.TaxDefinitionId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class SalesRouteConfiguration : IEntityTypeConfiguration<SalesRoute>
{
    public void Configure(EntityTypeBuilder<SalesRoute> builder)
    {
        builder.ToTable("sales_routes");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Name).IsRequired().HasMaxLength(120);
        builder.HasIndex(r => new { r.CompanyId, r.Name }).IsUnique();
        builder.HasMany(r => r.Stops).WithOne().HasForeignKey(s => s.RouteId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Warehouse>().WithMany().HasForeignKey(r => r.WarehouseId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class SalesRouteStopConfiguration : IEntityTypeConfiguration<SalesRouteStop>
{
    public void Configure(EntityTypeBuilder<SalesRouteStop> builder)
    {
        builder.ToTable("sales_route_stops");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Notes).HasMaxLength(500);
        builder.HasIndex(s => new { s.RouteId, s.PartnerId }).IsUnique();
        builder.HasOne<Partner>().WithMany().HasForeignKey(s => s.PartnerId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class RouteVisitConfiguration : IEntityTypeConfiguration<RouteVisit>
{
    public void Configure(EntityTypeBuilder<RouteVisit> builder)
    {
        builder.ToTable("route_visits");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.Outcome).HasConversion<string>().HasMaxLength(16);
        builder.Property(v => v.Collected).HasColumnType("numeric(18,2)");
        builder.Property(v => v.Notes).HasMaxLength(1000);
        builder.HasIndex(v => new { v.CompanyId, v.Date, v.UserId });
        builder.HasOne<Company>().WithMany().HasForeignKey(v => v.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(v => v.PartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<SalesRoute>().WithMany().HasForeignKey(v => v.RouteId).OnDelete(DeleteBehavior.SetNull);
    }
}
