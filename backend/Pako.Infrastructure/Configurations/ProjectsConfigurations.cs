using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Projects;

namespace Pako.Infrastructure.Configurations;

// docs/ERP_VERTICALS_PLAN.md — construction, real estate sales, property rental (phase 1).
public class ConstructionSiteConfiguration : IEntityTypeConfiguration<ConstructionSite>
{
    public void Configure(EntityTypeBuilder<ConstructionSite> builder)
    {
        builder.ToTable("construction_sites");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Name).IsRequired().HasMaxLength(160);
        builder.Property(s => s.Address).HasMaxLength(300);
        builder.Property(s => s.ContractValue).HasColumnType("numeric(18,2)");
        builder.Property(s => s.RetentionPercent).HasColumnType("numeric(5,2)");
        builder.Property(s => s.RetentionReleased).HasColumnType("numeric(18,2)");
        builder.Property(s => s.State).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(s => s.ProjectId).IsUnique();
        builder.HasMany(s => s.CostCodes).WithOne().HasForeignKey(c => c.SiteId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(s => s.Boq).WithOne().HasForeignKey(b => b.SiteId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Project>().WithMany().HasForeignKey(s => s.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(s => s.ClientPartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Item>().WithMany().HasForeignKey(s => s.BillingItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class CostCodeConfiguration : IEntityTypeConfiguration<CostCode>
{
    public void Configure(EntityTypeBuilder<CostCode> builder)
    {
        builder.ToTable("construction_cost_codes");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Code).IsRequired().HasMaxLength(20);
        builder.Property(c => c.Name).IsRequired().HasMaxLength(160);
        builder.Property(c => c.Budget).HasColumnType("numeric(18,2)");
        builder.HasIndex(c => new { c.SiteId, c.Code }).IsUnique();
    }
}

public class BoqLineConfiguration : IEntityTypeConfiguration<BoqLine>
{
    public void Configure(EntityTypeBuilder<BoqLine> builder)
    {
        builder.ToTable("construction_boq_lines");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Code).IsRequired().HasMaxLength(20);
        builder.Property(b => b.Description).IsRequired().HasMaxLength(500);
        builder.Property(b => b.Unit).IsRequired().HasMaxLength(20);
        builder.Property(b => b.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(b => b.UnitPrice).HasColumnType("numeric(18,4)");
        builder.HasIndex(b => new { b.SiteId, b.Code }).IsUnique();
    }
}

public class ProgressBillConfiguration : IEntityTypeConfiguration<ProgressBill>
{
    public void Configure(EntityTypeBuilder<ProgressBill> builder)
    {
        builder.ToTable("construction_progress_bills");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.Amount).HasColumnType("numeric(18,2)");
        builder.Property(p => p.Retention).HasColumnType("numeric(18,2)");
        builder.HasIndex(p => new { p.SiteId, p.Number }).IsUnique();
        builder.HasMany(p => p.Lines).WithOne().HasForeignKey(l => l.ProgressBillId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ConstructionSite>().WithMany().HasForeignKey(p => p.SiteId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Pako.Domain.Invoicing.Invoice>().WithMany().HasForeignKey(p => p.InvoiceId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class ProgressBillLineConfiguration : IEntityTypeConfiguration<ProgressBillLine>
{
    public void Configure(EntityTypeBuilder<ProgressBillLine> builder)
    {
        builder.ToTable("construction_progress_bill_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.CumulativeQuantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.PreviousQuantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.Amount).HasColumnType("numeric(18,2)");
        builder.HasOne<BoqLine>().WithMany().HasForeignKey(l => l.BoqLineId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class BuildingConfiguration : IEntityTypeConfiguration<Building>
{
    public void Configure(EntityTypeBuilder<Building> builder)
    {
        builder.ToTable("re_buildings");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Name).IsRequired().HasMaxLength(160);
        builder.Property(b => b.Address).HasMaxLength(300);
        builder.HasIndex(b => new { b.CompanyId, b.Name }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(b => b.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Project>().WithMany().HasForeignKey(b => b.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Item>().WithMany().HasForeignKey(b => b.SaleItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PropertyUnitConfiguration : IEntityTypeConfiguration<PropertyUnit>
{
    public void Configure(EntityTypeBuilder<PropertyUnit> builder)
    {
        builder.ToTable("re_units");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.Number).IsRequired().HasMaxLength(20);
        builder.Property(u => u.Floor).HasMaxLength(10);
        builder.Property(u => u.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(u => u.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(u => u.Area).HasColumnType("numeric(10,2)");
        builder.Property(u => u.ListPrice).HasColumnType("numeric(18,2)");
        builder.HasIndex(u => new { u.BuildingId, u.Number }).IsUnique();
        builder.HasOne<Building>().WithMany().HasForeignKey(u => u.BuildingId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class UnitReservationConfiguration : IEntityTypeConfiguration<UnitReservation>
{
    public void Configure(EntityTypeBuilder<UnitReservation> builder)
    {
        builder.ToTable("re_reservations");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Deposit).HasColumnType("numeric(18,2)");
        builder.Property(r => r.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(r => r.Notes).HasMaxLength(1000);
        builder.HasOne<PropertyUnit>().WithMany().HasForeignKey(r => r.UnitId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(r => r.PartnerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class UnitSaleContractConfiguration : IEntityTypeConfiguration<UnitSaleContract>
{
    public void Configure(EntityTypeBuilder<UnitSaleContract> builder)
    {
        builder.ToTable("re_sale_contracts");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Number).IsRequired().HasMaxLength(20);
        builder.Property(c => c.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(c => c.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(c => c.Price).HasColumnType("numeric(18,2)");
        builder.Property(c => c.Notes).HasMaxLength(2000);
        builder.HasIndex(c => new { c.CompanyId, c.Number }).IsUnique();
        builder.HasMany(c => c.Installments).WithOne().HasForeignKey(i => i.ContractId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PropertyUnit>().WithMany().HasForeignKey(c => c.UnitId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(c => c.BuyerPartnerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class InstallmentConfiguration : IEntityTypeConfiguration<Installment>
{
    public void Configure(EntityTypeBuilder<Installment> builder)
    {
        builder.ToTable("re_installments");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.Amount).HasColumnType("numeric(18,2)");
        builder.HasIndex(i => new { i.ContractId, i.Number }).IsUnique();
        builder.HasOne<Pako.Domain.Invoicing.Invoice>().WithMany().HasForeignKey(i => i.InvoiceId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class LeaseConfiguration : IEntityTypeConfiguration<Lease>
{
    public void Configure(EntityTypeBuilder<Lease> builder)
    {
        builder.ToTable("re_leases");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Number).IsRequired().HasMaxLength(20);
        builder.Property(l => l.Property).HasMaxLength(300);
        builder.Property(l => l.Rent).HasColumnType("numeric(18,2)");
        builder.Property(l => l.Deposit).HasColumnType("numeric(18,2)");
        builder.Property(l => l.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(l => l.Notes).HasMaxLength(2000);
        builder.HasIndex(l => new { l.CompanyId, l.Number }).IsUnique();
        builder.HasMany(l => l.Meters).WithOne().HasForeignKey(m => m.LeaseId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(l => l.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PropertyUnit>().WithMany().HasForeignKey(l => l.UnitId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(l => l.TenantPartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.RentItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class LeaseMeterConfiguration : IEntityTypeConfiguration<LeaseMeter>
{
    public void Configure(EntityTypeBuilder<LeaseMeter> builder)
    {
        builder.ToTable("re_lease_meters");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Name).IsRequired().HasMaxLength(60);
        builder.Property(m => m.LastReading).HasColumnType("numeric(18,3)");
        builder.Property(m => m.PendingReading).HasColumnType("numeric(18,3)");
        builder.HasOne<Item>().WithMany().HasForeignKey(m => m.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class LeaseInvoiceConfiguration : IEntityTypeConfiguration<LeaseInvoice>
{
    public void Configure(EntityTypeBuilder<LeaseInvoice> builder)
    {
        builder.ToTable("re_lease_invoices");
        builder.HasKey(l => l.Id);
        builder.HasIndex(l => new { l.LeaseId, l.Period }).IsUnique();
        builder.HasOne<Lease>().WithMany().HasForeignKey(l => l.LeaseId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Pako.Domain.Invoicing.Invoice>().WithMany().HasForeignKey(l => l.InvoiceId).OnDelete(DeleteBehavior.Cascade);
    }
}
