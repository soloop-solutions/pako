using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Pos;

namespace Pako.Infrastructure.Configurations;

// docs/POS_PLAN.md §12. Money numeric(18,2); quantities numeric(18,4); prices numeric(18,4).
public class StoreConfiguration : IEntityTypeConfiguration<Store>
{
    public void Configure(EntityTypeBuilder<Store> builder)
    {
        builder.ToTable("pos_stores");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Code).IsRequired().HasMaxLength(20);
        builder.Property(s => s.Name).IsRequired().HasMaxLength(120);
        builder.Property(s => s.Address).HasMaxLength(256);
        builder.Property(s => s.Location).IsRequired().HasMaxLength(120);
        builder.Property(s => s.ReceiptHeader).HasMaxLength(500);
        builder.Property(s => s.ReceiptFooter).HasMaxLength(500);
        builder.HasIndex(s => new { s.CompanyId, s.Code }).IsUnique();
        builder.HasIndex(s => new { s.CompanyId, s.FiscalBranchNumber }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Warehouse>().WithMany().HasForeignKey(s => s.WarehouseId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<PriceList>().WithMany().HasForeignKey(s => s.PriceListId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Pako.Domain.Ledger.Account>().WithMany().HasForeignKey(s => s.TipsAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(s => s.BookingToken).HasMaxLength(40);
        builder.HasIndex(s => s.BookingToken).IsUnique().HasFilter("\"BookingToken\" IS NOT NULL");
        builder.HasOne<Item>().WithMany().HasForeignKey(s => s.TouristTaxItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PosRegisterConfiguration : IEntityTypeConfiguration<PosRegister>
{
    public void Configure(EntityTypeBuilder<PosRegister> builder)
    {
        builder.ToTable("pos_registers");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Code).IsRequired().HasMaxLength(20);
        builder.Property(r => r.Name).IsRequired().HasMaxLength(120);
        builder.Property(r => r.Profile).HasConversion<string>().HasMaxLength(16);
        builder.Property(r => r.FiscalMode).HasConversion<string>().HasMaxLength(16);
        builder.Property(r => r.FiscalizationNumber).HasMaxLength(64);
        builder.Property(r => r.CertificateThumbprint).HasMaxLength(64);
        builder.HasIndex(r => new { r.CompanyId, r.Code }).IsUnique();
        // ATK: a PosId is unique within its branch.
        builder.HasIndex(r => new { r.StoreId, r.FiscalPosNumber }).IsUnique();
        builder.HasOne<Store>().WithMany().HasForeignKey(r => r.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class PosSessionConfiguration : IEntityTypeConfiguration<PosSession>
{
    public void Configure(EntityTypeBuilder<PosSession> builder)
    {
        builder.ToTable("pos_sessions");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(s => s.OpeningFloat).HasColumnType("numeric(18,2)");
        builder.Property(s => s.ZReportJson).HasColumnType("jsonb");
        builder.HasIndex(s => new { s.RegisterId, s.Number }).IsUnique();
        // At most one open session per register.
        builder.HasIndex(s => s.RegisterId).IsUnique().HasFilter("\"State\" = 'Open'").HasDatabaseName("IX_pos_sessions_one_open");
        builder.HasMany(s => s.CashMovements).WithOne(m => m.Session).HasForeignKey(m => m.SessionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(s => s.Tenders).WithOne(t => t.Session).HasForeignKey(t => t.SessionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PosRegister>().WithMany().HasForeignKey(s => s.RegisterId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class PosCashMovementConfiguration : IEntityTypeConfiguration<PosCashMovement>
{
    public void Configure(EntityTypeBuilder<PosCashMovement> builder)
    {
        builder.ToTable("pos_cash_movements");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(m => m.Amount).HasColumnType("numeric(18,2)");
        builder.Property(m => m.Reason).IsRequired().HasMaxLength(256);
    }
}

public class PosSessionTenderConfiguration : IEntityTypeConfiguration<PosSessionTender>
{
    public void Configure(EntityTypeBuilder<PosSessionTender> builder)
    {
        builder.ToTable("pos_session_tenders");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Expected).HasColumnType("numeric(18,2)");
        builder.Property(t => t.Counted).HasColumnType("numeric(18,2)");
        builder.Property(t => t.Difference).HasColumnType("numeric(18,2)");
        builder.Property(t => t.DifferenceReason).HasMaxLength(256);
        builder.HasIndex(t => new { t.SessionId, t.PaymentMethodId }).IsUnique();
    }
}

public class PosOrderConfiguration : IEntityTypeConfiguration<PosOrder>
{
    public void Configure(EntityTypeBuilder<PosOrder> builder)
    {
        builder.ToTable("pos_orders");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(o => o.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(o => o.Number).IsRequired().HasMaxLength(40);
        builder.Property(o => o.OperatorName).IsRequired().HasMaxLength(120);
        builder.Property(o => o.Reason).HasMaxLength(256);
        builder.Property(o => o.Total).HasColumnType("numeric(18,2)");
        builder.Property(o => o.TotalTax).HasColumnType("numeric(18,2)");
        builder.Property(o => o.TotalDiscount).HasColumnType("numeric(18,2)");
        builder.Property(o => o.CouponCodes).HasMaxLength(200);
        builder.Property(o => o.PointsEarned).HasColumnType("numeric(18,4)");
        builder.Property(o => o.PointsRedeemed).HasColumnType("numeric(18,4)");
        builder.HasOne<LoyaltyCard>().WithMany().HasForeignKey(o => o.LoyaltyCardId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Tab>().WithMany().HasForeignKey(o => o.TabId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Appointment>().WithMany().HasForeignKey(o => o.AppointmentId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RepairTicket>().WithMany().HasForeignKey(o => o.RepairTicketId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Prescription>().WithMany().HasForeignKey(o => o.PrescriptionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<FleetCard>().WithMany().HasForeignKey(o => o.FleetCardId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ChannelOrder>().WithMany().HasForeignKey(o => o.ChannelOrderId).OnDelete(DeleteBehavior.Restrict);
        // D11: a till's order id is unique per company, so a resent order is recognised.
        builder.HasIndex(o => new { o.CompanyId, o.ClientUuid }).IsUnique();
        builder.HasIndex(o => new { o.SessionId, o.Kind });
        builder.HasIndex(o => new { o.CompanyId, o.OrderedAt });
        builder.HasMany(o => o.Lines).WithOne(l => l.Order).HasForeignKey(l => l.OrderId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(o => o.Payments).WithOne(p => p.Order).HasForeignKey(p => p.OrderId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PosSession>().WithMany().HasForeignKey(o => o.SessionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<PosOrder>().WithMany().HasForeignKey(o => o.OriginalOrderId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(o => o.CustomerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PosOrderLineConfiguration : IEntityTypeConfiguration<PosOrderLine>
{
    public void Configure(EntityTypeBuilder<PosOrderLine> builder)
    {
        builder.ToTable("pos_order_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).IsRequired().HasMaxLength(256);
        builder.Property(l => l.Unit).HasMaxLength(32);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitFactor).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,4)");
        builder.Property(l => l.DiscountAmount).HasColumnType("numeric(18,2)");
        builder.Property(l => l.TaxLetter).IsRequired().HasMaxLength(1);
        builder.Property(l => l.TaxRate).HasColumnType("numeric(9,4)");
        builder.Property(l => l.Gross).HasColumnType("numeric(18,2)");
        builder.Property(l => l.Net).HasColumnType("numeric(18,2)");
        builder.Property(l => l.Tax).HasColumnType("numeric(18,2)");
        builder.Property(l => l.CostValue).HasColumnType("numeric(18,2)");
        builder.Property(l => l.CostCorrection).HasColumnType("numeric(18,2)");
        builder.Property(l => l.CostReplay).HasColumnType("numeric(18,2)");
        builder.Property(l => l.ProgramDiscount).HasColumnType("numeric(18,2)");
        builder.Property(l => l.GiftCardNumber).HasMaxLength(40);
        builder.Property(l => l.SerialNumber).HasMaxLength(64);
        builder.Property(l => l.PackageNumber).HasMaxLength(40);
        builder.Property(l => l.MembershipNumber).HasMaxLength(40);
        builder.Property(l => l.AgencyCommission).HasColumnType("numeric(18,2)");
        builder.HasOne<PrescriptionLine>().WithMany().HasForeignKey(l => l.PrescriptionLineId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<FuelNozzle>().WithMany().HasForeignKey(l => l.NozzleId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(l => l.ModifierIds).HasMaxLength(800);
        builder.HasOne<TabLine>().WithMany().HasForeignKey(l => l.TabLineId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(l => l.LotNumber).HasMaxLength(64);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PosPaymentConfiguration : IEntityTypeConfiguration<PosPayment>
{
    public void Configure(EntityTypeBuilder<PosPayment> builder)
    {
        builder.ToTable("pos_payments");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Amount).HasColumnType("numeric(18,2)");
        builder.Property(p => p.Tendered).HasColumnType("numeric(18,2)");
        builder.Property(p => p.Tip).HasColumnType("numeric(18,2)");
        builder.HasOne<Partner>().WithMany().HasForeignKey(p => p.PartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(p => p.Reference).HasMaxLength(128);
        builder.HasOne<PaymentMethod>().WithMany().HasForeignKey(p => p.PaymentMethodId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class FiscalDocumentConfiguration : IEntityTypeConfiguration<FiscalDocument>
{
    public void Configure(EntityTypeBuilder<FiscalDocument> builder)
    {
        builder.ToTable("fiscal_documents");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Type).HasConversion<string>().HasMaxLength(16);
        builder.Property(d => d.AtkStatus).HasConversion<string>().HasMaxLength(16);
        builder.Property(d => d.VerificationNo).IsRequired().HasMaxLength(16);
        builder.Property(d => d.PosCouponDetails).IsRequired();
        builder.Property(d => d.Signature).IsRequired().HasMaxLength(256);
        builder.Property(d => d.QrCode).IsRequired();
        builder.Property(d => d.AtkError).HasMaxLength(1000);
        // ATK: CouponId is unique across the whole business.
        builder.HasIndex(d => new { d.CompanyId, d.CouponId }).IsUnique();
        builder.HasIndex(d => d.OrderId).IsUnique();
        builder.HasIndex(d => new { d.CompanyId, d.AtkStatus });
        builder.HasOne<PosOrder>().WithMany().HasForeignKey(d => d.OrderId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<PosRegister>().WithMany().HasForeignKey(d => d.RegisterId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class BarcodeRuleConfiguration : IEntityTypeConfiguration<BarcodeRule>
{
    public void Configure(EntityTypeBuilder<BarcodeRule> builder)
    {
        builder.ToTable("pos_barcode_rules");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Prefix).IsRequired().HasMaxLength(2);
        builder.Property(r => r.Kind).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(r => new { r.CompanyId, r.Prefix }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class PosProgramConfiguration : IEntityTypeConfiguration<PosProgram>
{
    public void Configure(EntityTypeBuilder<PosProgram> builder)
    {
        builder.ToTable("pos_programs");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Name).IsRequired().HasMaxLength(120);
        builder.Property(p => p.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.Reward).HasConversion<string>().HasMaxLength(24);
        builder.Property(p => p.Code).HasMaxLength(40);
        builder.Property(p => p.MinQuantity).HasColumnType("numeric(18,4)");
        builder.Property(p => p.MinAmount).HasColumnType("numeric(18,2)");
        builder.Property(p => p.Percent).HasColumnType("numeric(9,4)");
        builder.Property(p => p.Amount).HasColumnType("numeric(18,2)");
        builder.Property(p => p.Price).HasColumnType("numeric(18,4)");
        builder.Property(p => p.PointsPerEuro).HasColumnType("numeric(18,4)");
        builder.Property(p => p.PointValue).HasColumnType("numeric(18,4)");
        builder.HasIndex(p => new { p.CompanyId, p.Code }).IsUnique().HasFilter("\"Code\" IS NOT NULL");
        builder.HasMany(p => p.Targets).WithOne().HasForeignKey(t => t.ProgramId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(p => p.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(p => p.StoreId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PosProgramTargetConfiguration : IEntityTypeConfiguration<PosProgramTarget>
{
    public void Configure(EntityTypeBuilder<PosProgramTarget> builder)
    {
        builder.ToTable("pos_program_targets");
        builder.HasKey(t => t.Id);
        builder.HasOne<Item>().WithMany().HasForeignKey(t => t.ItemId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ItemCategory>().WithMany().HasForeignKey(t => t.CategoryId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class LoyaltyCardConfiguration : IEntityTypeConfiguration<LoyaltyCard>
{
    public void Configure(EntityTypeBuilder<LoyaltyCard> builder)
    {
        builder.ToTable("pos_loyalty_cards");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Number).IsRequired().HasMaxLength(40);
        builder.Property(c => c.HolderName).HasMaxLength(120);
        builder.Property(c => c.Phone).HasMaxLength(40);
        builder.Property(c => c.Points).HasColumnType("numeric(18,4)");
        builder.HasIndex(c => new { c.CompanyId, c.Number }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(c => c.PartnerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class GiftCardConfiguration : IEntityTypeConfiguration<GiftCard>
{
    public void Configure(EntityTypeBuilder<GiftCard> builder)
    {
        builder.ToTable("pos_gift_cards");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Number).IsRequired().HasMaxLength(40);
        builder.Property(c => c.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(c => c.Balance).HasColumnType("numeric(18,2)");
        builder.HasIndex(c => new { c.CompanyId, c.Number }).IsUnique();
        builder.HasMany(c => c.Movements).WithOne().HasForeignKey(m => m.GiftCardId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(c => c.PartnerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class GiftCardMovementConfiguration : IEntityTypeConfiguration<GiftCardMovement>
{
    public void Configure(EntityTypeBuilder<GiftCardMovement> builder)
    {
        builder.ToTable("pos_gift_card_movements");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Amount).HasColumnType("numeric(18,2)");
        builder.HasOne<PosOrder>().WithMany().HasForeignKey(m => m.OrderId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class CustomerOrderConfiguration : IEntityTypeConfiguration<CustomerOrder>
{
    public void Configure(EntityTypeBuilder<CustomerOrder> builder)
    {
        builder.ToTable("pos_customer_orders");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.Number).IsRequired().HasMaxLength(40);
        builder.Property(o => o.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(o => o.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(o => o.Notes).HasMaxLength(500);
        builder.HasIndex(o => new { o.CompanyId, o.Number }).IsUnique();
        builder.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.CustomerOrderId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(o => o.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(o => o.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(o => o.CustomerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<GiftCard>().WithMany().HasForeignKey(o => o.DepositCardId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<PosOrder>().WithMany().HasForeignKey(o => o.CollectedOrderId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class CustomerOrderLineConfiguration : IEntityTypeConfiguration<CustomerOrderLine>
{
    public void Configure(EntityTypeBuilder<CustomerOrderLine> builder)
    {
        builder.ToTable("pos_customer_order_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).IsRequired().HasMaxLength(256);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,4)");
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

// ---- P3: hospitality ----

public class FloorConfiguration : IEntityTypeConfiguration<Floor>
{
    public void Configure(EntityTypeBuilder<Floor> builder)
    {
        builder.ToTable("pos_floors");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.Name).IsRequired().HasMaxLength(60);
        builder.HasMany(f => f.Tables).WithOne().HasForeignKey(t => t.FloorId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(f => f.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(f => f.StoreId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class DiningTableConfiguration : IEntityTypeConfiguration<DiningTable>
{
    public void Configure(EntityTypeBuilder<DiningTable> builder)
    {
        builder.ToTable("pos_tables");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).IsRequired().HasMaxLength(30);
        builder.Property(t => t.Shape).HasConversion<string>().HasMaxLength(16);
        builder.Property(t => t.QrToken).IsRequired().HasMaxLength(40);
        builder.HasIndex(t => t.QrToken).IsUnique();
    }
}

public class TabConfiguration : IEntityTypeConfiguration<Tab>
{
    public void Configure(EntityTypeBuilder<Tab> builder)
    {
        builder.ToTable("pos_tabs");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Number).IsRequired().HasMaxLength(40);
        builder.Property(t => t.Name).HasMaxLength(120);
        builder.Property(t => t.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(t => t.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(t => t.WaiterName).IsRequired().HasMaxLength(120);
        builder.Property(t => t.DeliveryAddress).HasMaxLength(256);
        builder.Property(t => t.DeliveryPhone).HasMaxLength(40);
        builder.Property(t => t.DriverName).HasMaxLength(120);
        builder.HasIndex(t => new { t.CompanyId, t.Number }).IsUnique();
        builder.HasIndex(t => new { t.StoreId, t.State });
        builder.HasMany(t => t.Lines).WithOne().HasForeignKey(l => l.TabId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(t => t.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<DiningTable>().WithMany().HasForeignKey(t => t.TableId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class TabLineConfiguration : IEntityTypeConfiguration<TabLine>
{
    public void Configure(EntityTypeBuilder<TabLine> builder)
    {
        builder.ToTable("pos_tab_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).IsRequired().HasMaxLength(256);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,4)");
        builder.Property(l => l.DiscountAmount).HasColumnType("numeric(18,2)");
        builder.Property(l => l.PaidQuantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(l => l.Note).HasMaxLength(256);
        builder.Property(l => l.Modifiers).HasMaxLength(500);
        builder.Property(l => l.VoidReason).HasMaxLength(256);
        builder.Property(l => l.ModifierIds).HasMaxLength(800);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class ProductionCenterConfiguration : IEntityTypeConfiguration<ProductionCenter>
{
    public void Configure(EntityTypeBuilder<ProductionCenter> builder)
    {
        builder.ToTable("pos_production_centers");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Name).IsRequired().HasMaxLength(60);
        builder.Property(c => c.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(c => c.PrinterName).HasMaxLength(120);
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(c => c.StoreId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ModifierGroupConfiguration : IEntityTypeConfiguration<ModifierGroup>
{
    public void Configure(EntityTypeBuilder<ModifierGroup> builder)
    {
        builder.ToTable("pos_modifier_groups");
        builder.HasKey(g => g.Id);
        builder.Property(g => g.Name).IsRequired().HasMaxLength(60);
        builder.HasMany(g => g.Modifiers).WithOne().HasForeignKey(m => m.GroupId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(g => g.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ModifierConfiguration : IEntityTypeConfiguration<Modifier>
{
    public void Configure(EntityTypeBuilder<Modifier> builder)
    {
        builder.ToTable("pos_modifiers");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Name).IsRequired().HasMaxLength(60);
        builder.Property(m => m.PriceDelta).HasColumnType("numeric(18,4)");
        builder.Property(m => m.IngredientQuantity).HasColumnType("numeric(18,4)");
        builder.HasOne<Item>().WithMany().HasForeignKey(m => m.IngredientItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class ItemModifierGroupConfiguration : IEntityTypeConfiguration<ItemModifierGroup>
{
    public void Configure(EntityTypeBuilder<ItemModifierGroup> builder)
    {
        builder.ToTable("pos_item_modifier_groups");
        builder.HasKey(x => new { x.ItemId, x.GroupId });
        builder.HasOne<Item>().WithMany().HasForeignKey(x => x.ItemId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ModifierGroup>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ComboSlotConfiguration : IEntityTypeConfiguration<ComboSlot>
{
    public void Configure(EntityTypeBuilder<ComboSlot> builder)
    {
        builder.ToTable("pos_combo_slots");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Name).IsRequired().HasMaxLength(60);
        builder.HasMany(s => s.Choices).WithOne().HasForeignKey(c => c.SlotId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(s => s.ComboItemId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ComboChoiceConfiguration : IEntityTypeConfiguration<ComboChoice>
{
    public void Configure(EntityTypeBuilder<ComboChoice> builder)
    {
        builder.ToTable("pos_combo_choices");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.PriceDelta).HasColumnType("numeric(18,4)");
        builder.HasOne<Item>().WithMany().HasForeignKey(c => c.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class KitchenTicketConfiguration : IEntityTypeConfiguration<KitchenTicket>
{
    public void Configure(EntityTypeBuilder<KitchenTicket> builder)
    {
        builder.ToTable("pos_kitchen_tickets");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(t => t.TabLabel).IsRequired().HasMaxLength(80);
        builder.Property(t => t.WaiterName).IsRequired().HasMaxLength(120);
        builder.HasIndex(t => new { t.StoreId, t.State });
        builder.HasMany(t => t.Lines).WithOne().HasForeignKey(l => l.TicketId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Tab>().WithMany().HasForeignKey(t => t.TabId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ProductionCenter>().WithMany().HasForeignKey(t => t.ProductionCenterId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class KitchenTicketLineConfiguration : IEntityTypeConfiguration<KitchenTicketLine>
{
    public void Configure(EntityTypeBuilder<KitchenTicketLine> builder)
    {
        builder.ToTable("pos_kitchen_ticket_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).IsRequired().HasMaxLength(256);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.Modifiers).HasMaxLength(500);
        builder.Property(l => l.Note).HasMaxLength(256);
    }
}

public class PosPinConfiguration : IEntityTypeConfiguration<PosPin>
{
    public void Configure(EntityTypeBuilder<PosPin> builder)
    {
        builder.ToTable("pos_pins");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.PinHash).IsRequired().HasMaxLength(200);
        builder.HasIndex(p => new { p.CompanyId, p.UserId }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(p => p.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class WaiterSettlementConfiguration : IEntityTypeConfiguration<WaiterSettlement>
{
    public void Configure(EntityTypeBuilder<WaiterSettlement> builder)
    {
        builder.ToTable("pos_waiter_settlements");
        builder.HasKey(w => w.Id);
        builder.Property(w => w.WaiterName).IsRequired().HasMaxLength(120);
        builder.Property(w => w.Expected).HasColumnType("numeric(18,2)");
        builder.Property(w => w.Handed).HasColumnType("numeric(18,2)");
        builder.Property(w => w.Difference).HasColumnType("numeric(18,2)");
        builder.Property(w => w.Reason).HasMaxLength(256);
        builder.HasIndex(w => new { w.SessionId, w.WaiterUserId }).IsUnique();
        builder.HasOne<PosSession>().WithMany().HasForeignKey(w => w.SessionId).OnDelete(DeleteBehavior.Cascade);
    }
}

// ---- P4: services ----

public class ServiceResourceConfiguration : IEntityTypeConfiguration<ServiceResource>
{
    public void Configure(EntityTypeBuilder<ServiceResource> builder)
    {
        builder.ToTable("pos_resources");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Name).IsRequired().HasMaxLength(80);
        builder.Property(r => r.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(r => r.Color).HasMaxLength(16);
        builder.HasMany(r => r.Hours).WithOne().HasForeignKey(h => h.ResourceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(r => r.StoreId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ResourceHoursConfiguration : IEntityTypeConfiguration<ResourceHours>
{
    public void Configure(EntityTypeBuilder<ResourceHours> builder)
    {
        builder.ToTable("pos_resource_hours");
        builder.HasKey(h => h.Id);
    }
}

public class ServiceResourceLinkConfiguration : IEntityTypeConfiguration<ServiceResourceLink>
{
    public void Configure(EntityTypeBuilder<ServiceResourceLink> builder)
    {
        builder.ToTable("pos_service_resources");
        builder.HasKey(l => new { l.ItemId, l.ResourceId });
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ServiceResource>().WithMany().HasForeignKey(l => l.ResourceId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class AppointmentConfiguration : IEntityTypeConfiguration<Appointment>
{
    public void Configure(EntityTypeBuilder<Appointment> builder)
    {
        builder.ToTable("pos_appointments");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Number).IsRequired().HasMaxLength(40);
        builder.Property(a => a.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(a => a.Source).HasConversion<string>().HasMaxLength(16);
        builder.Property(a => a.CustomerName).IsRequired().HasMaxLength(120);
        builder.Property(a => a.Phone).HasMaxLength(40);
        builder.Property(a => a.Email).HasMaxLength(256);
        builder.Property(a => a.Notes).HasMaxLength(500);
        builder.Property(a => a.CancelReason).HasMaxLength(256);
        builder.HasIndex(a => new { a.CompanyId, a.Number }).IsUnique();
        builder.HasIndex(a => new { a.ResourceId, a.Start });
        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(a => a.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Item>().WithMany().HasForeignKey(a => a.ItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ServiceResource>().WithMany().HasForeignKey(a => a.ResourceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(a => a.CustomerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<GiftCard>().WithMany().HasForeignKey(a => a.DepositCardId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class CustomerPackageConfiguration : IEntityTypeConfiguration<CustomerPackage>
{
    public void Configure(EntityTypeBuilder<CustomerPackage> builder)
    {
        builder.ToTable("pos_packages");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Number).IsRequired().HasMaxLength(40);
        builder.Property(p => p.HolderName).HasMaxLength(120);
        builder.Property(p => p.Phone).HasMaxLength(40);
        builder.Property(p => p.UnitValue).HasColumnType("numeric(18,4)");
        builder.HasIndex(p => new { p.CompanyId, p.Number }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(p => p.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(p => p.ServiceItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(p => p.CustomerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class CustomerMembershipConfiguration : IEntityTypeConfiguration<CustomerMembership>
{
    public void Configure(EntityTypeBuilder<CustomerMembership> builder)
    {
        builder.ToTable("pos_memberships");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Number).IsRequired().HasMaxLength(40);
        builder.Property(m => m.HolderName).HasMaxLength(120);
        builder.Property(m => m.Phone).HasMaxLength(40);
        builder.Property(m => m.State).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(m => new { m.CompanyId, m.Number }).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(m => m.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(m => m.PlanItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(m => m.CustomerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class RepairTicketConfiguration : IEntityTypeConfiguration<RepairTicket>
{
    public void Configure(EntityTypeBuilder<RepairTicket> builder)
    {
        builder.ToTable("pos_repair_tickets");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Number).IsRequired().HasMaxLength(40);
        builder.Property(t => t.State).HasConversion<string>().HasMaxLength(20);
        builder.Property(t => t.CustomerName).IsRequired().HasMaxLength(120);
        builder.Property(t => t.Phone).HasMaxLength(40);
        builder.Property(t => t.Email).HasMaxLength(256);
        builder.Property(t => t.Device).IsRequired().HasMaxLength(160);
        builder.Property(t => t.SerialOrPlate).HasMaxLength(64);
        builder.Property(t => t.Problem).IsRequired().HasMaxLength(1000);
        builder.Property(t => t.Accessories).HasMaxLength(500);
        builder.Property(t => t.Notes).HasMaxLength(1000);
        builder.HasIndex(t => new { t.CompanyId, t.Number }).IsUnique();
        builder.HasMany(t => t.Lines).WithOne().HasForeignKey(l => l.TicketId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(t => t.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(t => t.CustomerId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class RepairTicketLineConfiguration : IEntityTypeConfiguration<RepairTicketLine>
{
    public void Configure(EntityTypeBuilder<RepairTicketLine> builder)
    {
        builder.ToTable("pos_repair_ticket_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).IsRequired().HasMaxLength(256);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,4)");
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

// ---- P5: hotels, venues, tickets ----

public class RoomTypeConfiguration : IEntityTypeConfiguration<RoomType>
{
    public void Configure(EntityTypeBuilder<RoomType> builder)
    {
        builder.ToTable("pos_room_types");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).IsRequired().HasMaxLength(80);
        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(t => t.StoreId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(t => t.RateItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class RoomConfiguration : IEntityTypeConfiguration<Room>
{
    public void Configure(EntityTypeBuilder<Room> builder)
    {
        builder.ToTable("pos_rooms");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Number).IsRequired().HasMaxLength(20);
        builder.Property(r => r.Floor).HasMaxLength(20);
        builder.Property(r => r.State).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(r => new { r.RoomTypeId, r.Number }).IsUnique();
        builder.HasOne<RoomType>().WithMany().HasForeignKey(r => r.RoomTypeId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class HotelBookingConfiguration : IEntityTypeConfiguration<HotelBooking>
{
    public void Configure(EntityTypeBuilder<HotelBooking> builder)
    {
        builder.ToTable("pos_hotel_bookings");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Number).IsRequired().HasMaxLength(40);
        builder.Property(b => b.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(b => b.GuestName).IsRequired().HasMaxLength(120);
        builder.Property(b => b.Phone).HasMaxLength(40);
        builder.Property(b => b.Email).HasMaxLength(256);
        builder.Property(b => b.Channel).HasMaxLength(40);
        builder.Property(b => b.NightlyRate).HasColumnType("numeric(18,4)");
        builder.Property(b => b.Notes).HasMaxLength(500);
        builder.HasIndex(b => new { b.CompanyId, b.Number }).IsUnique();
        builder.HasIndex(b => new { b.RoomTypeId, b.Arrival });
        builder.HasOne<Company>().WithMany().HasForeignKey(b => b.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(b => b.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RoomType>().WithMany().HasForeignKey(b => b.RoomTypeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Room>().WithMany().HasForeignKey(b => b.RoomId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(b => b.CompanyPartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<GiftCard>().WithMany().HasForeignKey(b => b.DepositCardId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Tab>().WithMany().HasForeignKey(b => b.FolioTabId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class HotelGuestConfiguration : IEntityTypeConfiguration<HotelGuest>
{
    public void Configure(EntityTypeBuilder<HotelGuest> builder)
    {
        builder.ToTable("pos_hotel_guests");
        builder.HasKey(g => g.Id);
        builder.Property(g => g.FullName).IsRequired().HasMaxLength(120);
        builder.Property(g => g.Nationality).HasMaxLength(60);
        builder.Property(g => g.DocumentType).HasMaxLength(40);
        builder.Property(g => g.DocumentNumber).HasMaxLength(60);
        builder.HasOne<HotelBooking>().WithMany().HasForeignKey(g => g.BookingId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class VenueConfiguration : IEntityTypeConfiguration<Venue>
{
    public void Configure(EntityTypeBuilder<Venue> builder)
    {
        builder.ToTable("pos_venues");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.Name).IsRequired().HasMaxLength(80);
        builder.HasOne<Company>().WithMany().HasForeignKey(v => v.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(v => v.StoreId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class EventBookingConfiguration : IEntityTypeConfiguration<EventBooking>
{
    public void Configure(EntityTypeBuilder<EventBooking> builder)
    {
        builder.ToTable("pos_event_bookings");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Number).IsRequired().HasMaxLength(40);
        builder.Property(e => e.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(e => e.CustomerName).IsRequired().HasMaxLength(120);
        builder.Property(e => e.Phone).HasMaxLength(40);
        builder.Property(e => e.PricePerGuest).HasColumnType("numeric(18,4)");
        builder.Property(e => e.BanquetNotes).HasMaxLength(4000);
        builder.Property(e => e.Notes).HasMaxLength(1000);
        builder.HasIndex(e => new { e.CompanyId, e.Number }).IsUnique();
        builder.HasIndex(e => new { e.VenueId, e.Date });
        builder.HasOne<Company>().WithMany().HasForeignKey(e => e.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(e => e.StoreId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Venue>().WithMany().HasForeignKey(e => e.VenueId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(e => e.CustomerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Item>().WithMany().HasForeignKey(e => e.PackageItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<GiftCard>().WithMany().HasForeignKey(e => e.DepositCardId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Tab>().WithMany().HasForeignKey(e => e.TabId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class TicketedEventConfiguration : IEntityTypeConfiguration<TicketedEvent>
{
    public void Configure(EntityTypeBuilder<TicketedEvent> builder)
    {
        builder.ToTable("pos_ticketed_events");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Name).IsRequired().HasMaxLength(120);
        builder.HasMany(e => e.TicketTypes).WithOne().HasForeignKey(t => t.EventId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(e => e.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Store>().WithMany().HasForeignKey(e => e.StoreId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class EventTicketTypeConfiguration : IEntityTypeConfiguration<EventTicketType>
{
    public void Configure(EntityTypeBuilder<EventTicketType> builder)
    {
        builder.ToTable("pos_event_ticket_types");
        builder.HasKey(t => t.Id);
        builder.HasIndex(t => new { t.EventId, t.ItemId }).IsUnique();
        builder.HasOne<Item>().WithMany().HasForeignKey(t => t.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class TicketConfiguration : IEntityTypeConfiguration<Ticket>
{
    public void Configure(EntityTypeBuilder<Ticket> builder)
    {
        builder.ToTable("pos_tickets");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Code).IsRequired().HasMaxLength(40);
        builder.Property(t => t.State).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(t => t.Code).IsUnique();
        builder.HasIndex(t => new { t.EventId, t.State });
        builder.HasOne<TicketedEvent>().WithMany().HasForeignKey(t => t.EventId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<PosOrder>().WithMany().HasForeignKey(t => t.OrderId).OnDelete(DeleteBehavior.Restrict);
    }
}

