using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Pos;

namespace Pako.Infrastructure.Configurations;

// docs/POS_PLAN.md P7 — pharmacy, fuel station, auto parts, online channels.
public class ThirdPartyPayerConfiguration : IEntityTypeConfiguration<ThirdPartyPayer>
{
    public void Configure(EntityTypeBuilder<ThirdPartyPayer> builder)
    {
        builder.ToTable("pos_payers");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Name).IsRequired().HasMaxLength(120);
        builder.Property(p => p.CoveragePercent).HasColumnType("numeric(5,2)");
        builder.HasIndex(p => new { p.CompanyId, p.Name }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(p => p.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(p => p.PartnerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PrescriptionConfiguration : IEntityTypeConfiguration<Prescription>
{
    public void Configure(EntityTypeBuilder<Prescription> builder)
    {
        builder.ToTable("pos_prescriptions");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Number).IsRequired().HasMaxLength(40);
        builder.Property(p => p.Prescriber).IsRequired().HasMaxLength(120);
        builder.Property(p => p.PrescriberLicence).HasMaxLength(40);
        builder.Property(p => p.PatientName).IsRequired().HasMaxLength(120);
        builder.Property(p => p.PatientPersonalNumber).HasMaxLength(20);
        builder.Property(p => p.CoveragePercent).HasColumnType("numeric(5,2)");
        builder.Property(p => p.State).HasConversion<string>().HasMaxLength(20);
        builder.Property(p => p.Notes).HasMaxLength(1000);
        builder.HasIndex(p => new { p.CompanyId, p.Number });
        builder.HasMany(p => p.Lines).WithOne().HasForeignKey(l => l.PrescriptionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(p => p.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(p => p.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ThirdPartyPayer>().WithMany().HasForeignKey(p => p.PayerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PrescriptionLineConfiguration : IEntityTypeConfiguration<PrescriptionLine>
{
    public void Configure(EntityTypeBuilder<PrescriptionLine> builder)
    {
        builder.ToTable("pos_prescription_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.Dispensed).HasColumnType("numeric(18,4)");
        builder.Property(l => l.Dosage).HasMaxLength(200);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class FuelTankConfiguration : IEntityTypeConfiguration<FuelTank>
{
    public void Configure(EntityTypeBuilder<FuelTank> builder)
    {
        builder.ToTable("pos_fuel_tanks");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).IsRequired().HasMaxLength(60);
        builder.Property(t => t.Capacity).HasColumnType("numeric(18,2)");
        builder.HasIndex(t => new { t.StoreId, t.Name }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(t => t.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Item>().WithMany().HasForeignKey(t => t.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class FuelNozzleConfiguration : IEntityTypeConfiguration<FuelNozzle>
{
    public void Configure(EntityTypeBuilder<FuelNozzle> builder)
    {
        builder.ToTable("pos_fuel_nozzles");
        builder.HasKey(n => n.Id);
        builder.HasIndex(n => new { n.StoreId, n.Pump, n.Number }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(n => n.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(n => n.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<FuelTank>().WithMany().HasForeignKey(n => n.TankId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class MeterReadingConfiguration : IEntityTypeConfiguration<MeterReading>
{
    public void Configure(EntityTypeBuilder<MeterReading> builder)
    {
        builder.ToTable("pos_meter_readings");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Opening).HasColumnType("numeric(18,3)");
        builder.Property(r => r.Closing).HasColumnType("numeric(18,3)");
        builder.HasIndex(r => new { r.NozzleId, r.Date });
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<FuelNozzle>().WithMany().HasForeignKey(r => r.NozzleId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PosSession>().WithMany().HasForeignKey(r => r.SessionId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class TankDipConfiguration : IEntityTypeConfiguration<TankDip>
{
    public void Configure(EntityTypeBuilder<TankDip> builder)
    {
        builder.ToTable("pos_tank_dips");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Volume).HasColumnType("numeric(18,2)");
        builder.Property(d => d.Water).HasColumnType("numeric(18,2)");
        builder.HasIndex(d => new { d.TankId, d.MeasuredAt });
        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<FuelTank>().WithMany().HasForeignKey(d => d.TankId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class FleetCardConfiguration : IEntityTypeConfiguration<FleetCard>
{
    public void Configure(EntityTypeBuilder<FleetCard> builder)
    {
        builder.ToTable("pos_fleet_cards");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Number).IsRequired().HasMaxLength(40);
        builder.Property(c => c.VehiclePlate).HasMaxLength(20);
        builder.Property(c => c.DriverName).HasMaxLength(120);
        builder.Property(c => c.LimitPerFill).HasColumnType("numeric(18,2)");
        builder.HasIndex(c => new { c.CompanyId, c.Number }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(c => c.PartnerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class ItemCrossReferenceConfiguration : IEntityTypeConfiguration<ItemCrossReference>
{
    public void Configure(EntityTypeBuilder<ItemCrossReference> builder)
    {
        builder.ToTable("item_cross_references");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Brand).IsRequired().HasMaxLength(60);
        builder.Property(r => r.Number).IsRequired().HasMaxLength(60);
        builder.Property(r => r.Normalized).IsRequired().HasMaxLength(60);
        builder.HasIndex(r => r.Normalized);
        builder.HasIndex(r => new { r.ItemId, r.Brand, r.Normalized }).IsUnique();
        builder.HasOne<Item>().WithMany().HasForeignKey(r => r.ItemId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ItemFitmentConfiguration : IEntityTypeConfiguration<ItemFitment>
{
    public void Configure(EntityTypeBuilder<ItemFitment> builder)
    {
        builder.ToTable("item_fitments");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.Make).IsRequired().HasMaxLength(60);
        builder.Property(f => f.Model).IsRequired().HasMaxLength(60);
        builder.Property(f => f.Engine).HasMaxLength(60);
        builder.HasIndex(f => new { f.Make, f.Model });
        builder.HasOne<Item>().WithMany().HasForeignKey(f => f.ItemId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class SalesChannelConfiguration : IEntityTypeConfiguration<SalesChannel>
{
    public void Configure(EntityTypeBuilder<SalesChannel> builder)
    {
        builder.ToTable("pos_sales_channels");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Name).IsRequired().HasMaxLength(120);
        builder.Property(c => c.Kind).HasConversion<string>().HasMaxLength(20);
        builder.Property(c => c.Token).IsRequired().HasMaxLength(64);
        builder.HasIndex(c => c.Token).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(c => c.StoreId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class ChannelOrderConfiguration : IEntityTypeConfiguration<ChannelOrder>
{
    public void Configure(EntityTypeBuilder<ChannelOrder> builder)
    {
        builder.ToTable("pos_channel_orders");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.Number).IsRequired().HasMaxLength(20);
        builder.Property(o => o.ExternalRef).IsRequired().HasMaxLength(64);
        builder.Property(o => o.State).HasConversion<string>().HasMaxLength(20);
        builder.Property(o => o.Fulfilment).HasConversion<string>().HasMaxLength(20);
        builder.Property(o => o.Payment).HasConversion<string>().HasMaxLength(20);
        builder.Property(o => o.CustomerName).IsRequired().HasMaxLength(120);
        builder.Property(o => o.Phone).HasMaxLength(40);
        builder.Property(o => o.Email).HasMaxLength(200);
        builder.Property(o => o.Address).HasMaxLength(300);
        builder.Property(o => o.City).HasMaxLength(80);
        builder.Property(o => o.Notes).HasMaxLength(1000);
        builder.Property(o => o.Total).HasColumnType("numeric(18,2)");
        builder.Property(o => o.ShippingFee).HasColumnType("numeric(18,2)");
        builder.Property(o => o.TrackingNumber).HasMaxLength(60);
        builder.Property(o => o.RemittanceRef).HasMaxLength(60);
        builder.HasIndex(o => new { o.ChannelId, o.ExternalRef }).IsUnique();
        builder.HasIndex(o => new { o.CompanyId, o.State });
        builder.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.ChannelOrderId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(o => o.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<SalesChannel>().WithMany().HasForeignKey(o => o.ChannelId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(o => o.CourierPartnerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class ChannelOrderLineConfiguration : IEntityTypeConfiguration<ChannelOrderLine>
{
    public void Configure(EntityTypeBuilder<ChannelOrderLine> builder)
    {
        builder.ToTable("pos_channel_order_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).HasMaxLength(512);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,4)");
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}
