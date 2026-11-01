using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Pako.Domain.Attachments;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Domain.Reconciliation;
using Pako.Domain.Shared;
using Pako.Domain.Tax;
using Pako.Infrastructure.Identity;

namespace Pako.Infrastructure;

public class PakoDbContext : IdentityUserContext<AppUser, Guid>
{
    public PakoDbContext(DbContextOptions<PakoDbContext> options) : base(options)
    {
    }

    public DbSet<Company> Companies => Set<Company>();
    public DbSet<CompanyBankAccount> CompanyBankAccounts => Set<CompanyBankAccount>();
    public DbSet<CompanyAccountDefaults> CompanyAccountDefaults => Set<CompanyAccountDefaults>();
    public DbSet<AccountLockException> AccountLockExceptions => Set<AccountLockException>();
    public DbSet<Firm> Firms => Set<Firm>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Partner> Partners => Set<Partner>();
    public DbSet<Item> Items => Set<Item>();
    public DbSet<ItemBarcode> ItemBarcodes => Set<ItemBarcode>();
    public DbSet<NumberSeries> NumberSeriesSet => Set<NumberSeries>();
    public DbSet<DocumentNumberAudit> DocumentNumberAudits => Set<DocumentNumberAudit>();
    public DbSet<PaymentMethod> PaymentMethods => Set<PaymentMethod>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<AccountGroup> AccountGroups => Set<AccountGroup>();
    public DbSet<Journal> Journals => Set<Journal>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalEntryLine> JournalEntryLines => Set<JournalEntryLine>();
    public DbSet<CostCenter> CostCenters => Set<CostCenter>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<TaxDefinition> TaxDefinitions => Set<TaxDefinition>();
    public DbSet<TaxRepartitionLine> TaxRepartitionLines => Set<TaxRepartitionLine>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<DocumentEditAudit> DocumentEditAudits => Set<DocumentEditAudit>();
    public DbSet<Bill> Bills => Set<Bill>();
    public DbSet<BillLine> BillLines => Set<BillLine>();
    public DbSet<Reconciliation> Reconciliations => Set<Reconciliation>();
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<PayrollRun> PayrollRuns => Set<PayrollRun>();
    public DbSet<PayslipLine> PayslipLines => Set<PayslipLine>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<WithholdingTaxEntry> WithholdingTaxEntries => Set<WithholdingTaxEntry>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<EmployeePartnerAssignment> EmployeePartnerAssignments => Set<EmployeePartnerAssignment>();
    public DbSet<EmployeeContract> EmployeeContracts => Set<EmployeeContract>();
    public DbSet<PayrollAdjustment> PayrollAdjustments => Set<PayrollAdjustment>();
    public DbSet<LeaveType> LeaveTypes => Set<LeaveType>();
    public DbSet<LeaveAllocation> LeaveAllocations => Set<LeaveAllocation>();
    public DbSet<StatutoryParameter> StatutoryParameters => Set<StatutoryParameter>();
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<PublicHoliday> PublicHolidays => Set<PublicHoliday>();
    public DbSet<Pako.Domain.Shared.AuditEntry> AuditEntries => Set<Pako.Domain.Shared.AuditEntry>();
    public DbSet<Pako.Domain.Shared.UserFavorite> UserFavorites => Set<Pako.Domain.Shared.UserFavorite>();
    public DbSet<Pako.Domain.Notifications.Notification> Notifications => Set<Pako.Domain.Notifications.Notification>();
    public DbSet<Pako.Domain.Notifications.CompanyNotificationSetting> CompanyNotificationSettings => Set<Pako.Domain.Notifications.CompanyNotificationSetting>();
    public DbSet<Pako.Domain.Notifications.JobLock> JobLocks => Set<Pako.Domain.Notifications.JobLock>();
    public DbSet<EmployeeProfileChange> EmployeeProfileChanges => Set<EmployeeProfileChange>();
    public DbSet<EmployeeLoan> EmployeeLoans => Set<EmployeeLoan>();
    public DbSet<CommissionPlan> CommissionPlans => Set<CommissionPlan>();
    public DbSet<EmployeePartnerAssignmentPeriod> EmployeePartnerAssignmentPeriods => Set<EmployeePartnerAssignmentPeriod>();
    public DbSet<ExpenseClaim> ExpenseClaims => Set<ExpenseClaim>();
    public DbSet<ExpenseClaimLine> ExpenseClaimLines => Set<ExpenseClaimLine>();
    public DbSet<TimeEntry> TimeEntries => Set<TimeEntry>();
    public DbSet<CompanyRole> CompanyRoles => Set<CompanyRole>();
    public DbSet<DashboardLayout> DashboardLayouts => Set<DashboardLayout>();
    public DbSet<Pako.Domain.Platform.AccountRequest> AccountRequests => Set<Pako.Domain.Platform.AccountRequest>();
    public DbSet<Pako.Domain.Platform.PlatformAuditEntry> PlatformAuditEntries => Set<Pako.Domain.Platform.PlatformAuditEntry>();

    // docs/INVENTORY_PLAN.md
    public DbSet<Pako.Domain.Inventory.ItemCategory> ItemCategories => Set<Pako.Domain.Inventory.ItemCategory>();
    public DbSet<Pako.Domain.Inventory.Warehouse> Warehouses => Set<Pako.Domain.Inventory.Warehouse>();
    public DbSet<Pako.Domain.Inventory.StockLocation> StockLocations => Set<Pako.Domain.Inventory.StockLocation>();
    public DbSet<Pako.Domain.Inventory.StockSettings> StockSettings => Set<Pako.Domain.Inventory.StockSettings>();
    public DbSet<Pako.Domain.Inventory.StockMove> StockMoves => Set<Pako.Domain.Inventory.StockMove>();
    public DbSet<Pako.Domain.Inventory.StockBalance> StockBalances => Set<Pako.Domain.Inventory.StockBalance>();
    public DbSet<Pako.Domain.Inventory.ItemCost> ItemCosts => Set<Pako.Domain.Inventory.ItemCost>();
    public DbSet<Pako.Domain.Inventory.StockDocument> StockDocuments => Set<Pako.Domain.Inventory.StockDocument>();
    public DbSet<Pako.Domain.Inventory.StockDocumentLine> StockDocumentLines => Set<Pako.Domain.Inventory.StockDocumentLine>();
    // docs/POS_PLAN.md
    public DbSet<Pako.Domain.Pos.Store> PosStores => Set<Pako.Domain.Pos.Store>();
    public DbSet<Pako.Domain.Pos.PosRegister> PosRegisters => Set<Pako.Domain.Pos.PosRegister>();
    public DbSet<Pako.Domain.Pos.PosSession> PosSessions => Set<Pako.Domain.Pos.PosSession>();
    public DbSet<Pako.Domain.Pos.PosCashMovement> PosCashMovements => Set<Pako.Domain.Pos.PosCashMovement>();
    public DbSet<Pako.Domain.Pos.PosSessionTender> PosSessionTenders => Set<Pako.Domain.Pos.PosSessionTender>();
    public DbSet<Pako.Domain.Pos.PosOrder> PosOrders => Set<Pako.Domain.Pos.PosOrder>();
    public DbSet<Pako.Domain.Pos.PosOrderLine> PosOrderLines => Set<Pako.Domain.Pos.PosOrderLine>();
    public DbSet<Pako.Domain.Pos.PosPayment> PosPayments => Set<Pako.Domain.Pos.PosPayment>();
    public DbSet<Pako.Domain.Pos.FiscalDocument> FiscalDocuments => Set<Pako.Domain.Pos.FiscalDocument>();
    public DbSet<Pako.Domain.Pos.BarcodeRule> PosBarcodeRules => Set<Pako.Domain.Pos.BarcodeRule>();
    public DbSet<Pako.Domain.Pos.PosProgram> PosPrograms => Set<Pako.Domain.Pos.PosProgram>();
    public DbSet<Pako.Domain.Pos.PosProgramTarget> PosProgramTargets => Set<Pako.Domain.Pos.PosProgramTarget>();
    public DbSet<Pako.Domain.Pos.LoyaltyCard> LoyaltyCards => Set<Pako.Domain.Pos.LoyaltyCard>();
    public DbSet<Pako.Domain.Pos.GiftCard> GiftCards => Set<Pako.Domain.Pos.GiftCard>();
    public DbSet<Pako.Domain.Pos.GiftCardMovement> GiftCardMovements => Set<Pako.Domain.Pos.GiftCardMovement>();
    public DbSet<ItemAttribute> ItemAttributes => Set<ItemAttribute>();
    public DbSet<ItemAttributeValue> ItemAttributeValues => Set<ItemAttributeValue>();
    public DbSet<ItemVariantValue> ItemVariantValues => Set<ItemVariantValue>();
    public DbSet<Pako.Domain.Inventory.ItemSerial> ItemSerials => Set<Pako.Domain.Inventory.ItemSerial>();
    public DbSet<Pako.Domain.Inventory.RecipeLine> RecipeLines => Set<Pako.Domain.Inventory.RecipeLine>();
    public DbSet<Pako.Domain.Pos.CustomerOrder> PosCustomerOrders => Set<Pako.Domain.Pos.CustomerOrder>();
    public DbSet<Pako.Domain.Pos.CustomerOrderLine> PosCustomerOrderLines => Set<Pako.Domain.Pos.CustomerOrderLine>();
    public DbSet<Pako.Domain.Pos.Floor> PosFloors => Set<Pako.Domain.Pos.Floor>();
    public DbSet<Pako.Domain.Pos.DiningTable> PosTables => Set<Pako.Domain.Pos.DiningTable>();
    public DbSet<Pako.Domain.Pos.Tab> PosTabs => Set<Pako.Domain.Pos.Tab>();
    public DbSet<Pako.Domain.Pos.TabLine> PosTabLines => Set<Pako.Domain.Pos.TabLine>();
    public DbSet<Pako.Domain.Pos.ProductionCenter> PosProductionCenters => Set<Pako.Domain.Pos.ProductionCenter>();
    public DbSet<Pako.Domain.Pos.ModifierGroup> PosModifierGroups => Set<Pako.Domain.Pos.ModifierGroup>();
    public DbSet<Pako.Domain.Pos.Modifier> PosModifiers => Set<Pako.Domain.Pos.Modifier>();
    public DbSet<Pako.Domain.Pos.ItemModifierGroup> PosItemModifierGroups => Set<Pako.Domain.Pos.ItemModifierGroup>();
    public DbSet<Pako.Domain.Pos.ComboSlot> PosComboSlots => Set<Pako.Domain.Pos.ComboSlot>();
    public DbSet<Pako.Domain.Pos.ComboChoice> PosComboChoices => Set<Pako.Domain.Pos.ComboChoice>();
    public DbSet<Pako.Domain.Pos.KitchenTicket> PosKitchenTickets => Set<Pako.Domain.Pos.KitchenTicket>();
    public DbSet<Pako.Domain.Pos.KitchenTicketLine> PosKitchenTicketLines => Set<Pako.Domain.Pos.KitchenTicketLine>();
    public DbSet<Pako.Domain.Pos.PosPin> PosPins => Set<Pako.Domain.Pos.PosPin>();
    public DbSet<Pako.Domain.Pos.WaiterSettlement> PosWaiterSettlements => Set<Pako.Domain.Pos.WaiterSettlement>();
    public DbSet<Pako.Domain.Pos.ServiceResource> PosResources => Set<Pako.Domain.Pos.ServiceResource>();
    public DbSet<Pako.Domain.Pos.ResourceHours> PosResourceHours => Set<Pako.Domain.Pos.ResourceHours>();
    public DbSet<Pako.Domain.Pos.ServiceResourceLink> PosServiceResources => Set<Pako.Domain.Pos.ServiceResourceLink>();
    public DbSet<Pako.Domain.Pos.Appointment> PosAppointments => Set<Pako.Domain.Pos.Appointment>();
    public DbSet<Pako.Domain.Pos.CustomerPackage> PosPackages => Set<Pako.Domain.Pos.CustomerPackage>();
    public DbSet<Pako.Domain.Pos.CustomerMembership> PosMemberships => Set<Pako.Domain.Pos.CustomerMembership>();
    public DbSet<Pako.Domain.Pos.RepairTicket> PosRepairTickets => Set<Pako.Domain.Pos.RepairTicket>();
    public DbSet<Pako.Domain.Pos.RepairTicketLine> PosRepairTicketLines => Set<Pako.Domain.Pos.RepairTicketLine>();
    public DbSet<Pako.Domain.Pos.ThirdPartyPayer> PosPayers => Set<Pako.Domain.Pos.ThirdPartyPayer>();
    public DbSet<Pako.Domain.Pos.Prescription> PosPrescriptions => Set<Pako.Domain.Pos.Prescription>();
    public DbSet<Pako.Domain.Pos.PrescriptionLine> PosPrescriptionLines => Set<Pako.Domain.Pos.PrescriptionLine>();
    public DbSet<Pako.Domain.Pos.FuelTank> PosFuelTanks => Set<Pako.Domain.Pos.FuelTank>();
    public DbSet<Pako.Domain.Pos.FuelNozzle> PosFuelNozzles => Set<Pako.Domain.Pos.FuelNozzle>();
    public DbSet<Pako.Domain.Pos.MeterReading> PosMeterReadings => Set<Pako.Domain.Pos.MeterReading>();
    public DbSet<Pako.Domain.Pos.TankDip> PosTankDips => Set<Pako.Domain.Pos.TankDip>();
    public DbSet<Pako.Domain.Pos.FleetCard> PosFleetCards => Set<Pako.Domain.Pos.FleetCard>();
    public DbSet<Pako.Domain.Pos.ItemCrossReference> ItemCrossReferences => Set<Pako.Domain.Pos.ItemCrossReference>();
    public DbSet<Pako.Domain.Pos.ItemFitment> ItemFitments => Set<Pako.Domain.Pos.ItemFitment>();
    public DbSet<Pako.Domain.Pos.SalesChannel> PosSalesChannels => Set<Pako.Domain.Pos.SalesChannel>();
    public DbSet<Pako.Domain.Pos.ChannelOrder> PosChannelOrders => Set<Pako.Domain.Pos.ChannelOrder>();
    public DbSet<Pako.Domain.Pos.ChannelOrderLine> PosChannelOrderLines => Set<Pako.Domain.Pos.ChannelOrderLine>();
    public DbSet<Pako.Domain.Projects.ConstructionSite> ConstructionSites => Set<Pako.Domain.Projects.ConstructionSite>();
    public DbSet<Pako.Domain.Projects.CostCode> CostCodes => Set<Pako.Domain.Projects.CostCode>();
    public DbSet<Pako.Domain.Projects.BoqLine> BoqLines => Set<Pako.Domain.Projects.BoqLine>();
    public DbSet<Pako.Domain.Projects.ProgressBill> ProgressBills => Set<Pako.Domain.Projects.ProgressBill>();
    public DbSet<Pako.Domain.Projects.ProgressBillLine> ProgressBillLines => Set<Pako.Domain.Projects.ProgressBillLine>();
    public DbSet<Pako.Domain.Projects.Building> Buildings => Set<Pako.Domain.Projects.Building>();
    public DbSet<Pako.Domain.Projects.PropertyUnit> PropertyUnits => Set<Pako.Domain.Projects.PropertyUnit>();
    public DbSet<Pako.Domain.Projects.UnitReservation> UnitReservations => Set<Pako.Domain.Projects.UnitReservation>();
    public DbSet<Pako.Domain.Projects.UnitSaleContract> UnitSaleContracts => Set<Pako.Domain.Projects.UnitSaleContract>();
    public DbSet<Pako.Domain.Projects.Installment> Installments => Set<Pako.Domain.Projects.Installment>();
    public DbSet<Pako.Domain.Projects.Lease> Leases => Set<Pako.Domain.Projects.Lease>();
    public DbSet<Pako.Domain.Projects.LeaseMeter> LeaseMeters => Set<Pako.Domain.Projects.LeaseMeter>();
    public DbSet<Pako.Domain.Projects.LeaseInvoice> LeaseInvoices => Set<Pako.Domain.Projects.LeaseInvoice>();
    public DbSet<Pako.Domain.Pos.RoomType> PosRoomTypes => Set<Pako.Domain.Pos.RoomType>();
    public DbSet<Pako.Domain.Pos.Room> PosRooms => Set<Pako.Domain.Pos.Room>();
    public DbSet<Pako.Domain.Pos.HotelBooking> PosHotelBookings => Set<Pako.Domain.Pos.HotelBooking>();
    public DbSet<Pako.Domain.Pos.HotelGuest> PosHotelGuests => Set<Pako.Domain.Pos.HotelGuest>();
    public DbSet<Pako.Domain.Pos.Venue> PosVenues => Set<Pako.Domain.Pos.Venue>();
    public DbSet<Pako.Domain.Pos.EventBooking> PosEventBookings => Set<Pako.Domain.Pos.EventBooking>();
    public DbSet<Pako.Domain.Pos.TicketedEvent> PosTicketedEvents => Set<Pako.Domain.Pos.TicketedEvent>();
    public DbSet<Pako.Domain.Pos.EventTicketType> PosEventTicketTypes => Set<Pako.Domain.Pos.EventTicketType>();
    public DbSet<Pako.Domain.Pos.Ticket> PosTickets => Set<Pako.Domain.Pos.Ticket>();
    public DbSet<Pako.Domain.Bills.PurchaseOrder> PurchaseOrders => Set<Pako.Domain.Bills.PurchaseOrder>();
    public DbSet<Pako.Domain.Invoicing.SalesOrder> SalesOrders => Set<Pako.Domain.Invoicing.SalesOrder>();
    public DbSet<Pako.Domain.Invoicing.SalesOrderLine> SalesOrderLines => Set<Pako.Domain.Invoicing.SalesOrderLine>();
    public DbSet<Pako.Domain.Inventory.SalesRoute> SalesRoutes => Set<Pako.Domain.Inventory.SalesRoute>();
    public DbSet<Pako.Domain.Inventory.SalesRouteStop> SalesRouteStops => Set<Pako.Domain.Inventory.SalesRouteStop>();
    public DbSet<Pako.Domain.Inventory.RouteVisit> RouteVisits => Set<Pako.Domain.Inventory.RouteVisit>();
    public DbSet<Pako.Domain.Bills.PurchaseOrderLine> PurchaseOrderLines => Set<Pako.Domain.Bills.PurchaseOrderLine>();
    public DbSet<Pako.Domain.Inventory.Lot> Lots => Set<Pako.Domain.Inventory.Lot>();
    public DbSet<Pako.Domain.Inventory.LotBalance> LotBalances => Set<Pako.Domain.Inventory.LotBalance>();
    public DbSet<Pako.Domain.Inventory.StockMoveLot> StockMoveLots => Set<Pako.Domain.Inventory.StockMoveLot>();
    public DbSet<Pako.Domain.Inventory.ReceiptMatch> ReceiptMatches => Set<Pako.Domain.Inventory.ReceiptMatch>();
    public DbSet<Pako.Domain.Inventory.PriceList> PriceLists => Set<Pako.Domain.Inventory.PriceList>();
    public DbSet<Pako.Domain.Inventory.PriceListPrice> PriceListPrices => Set<Pako.Domain.Inventory.PriceListPrice>();
    public DbSet<Pako.Domain.Inventory.PriceChange> PriceChanges => Set<Pako.Domain.Inventory.PriceChange>();
    public DbSet<Pako.Domain.Inventory.PriceChangeLine> PriceChangeLines => Set<Pako.Domain.Inventory.PriceChangeLine>();
    public DbSet<UserInvitation> UserInvitations => Set<UserInvitation>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PakoDbContext).Assembly);

        modelBuilder.Entity<Pako.Domain.Shared.AuditEntry>(entity =>
        {
            entity.ToTable("audit_entries");
            entity.HasIndex(e => new { e.CompanyId, e.EntityType, e.EntityId });
            entity.HasIndex(e => new { e.CompanyId, e.OccurredAtUtc });
        });
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ValidateImmutability();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override async Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        await ValidateImmutabilityAsync(cancellationToken);
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    // ReconciledFlag/ReconciliationId are reconciliation bookkeeping, set on a JournalEntryLine
    // after the fact as it gets consumed by Reconciliation rows — they're deliberately outside the
    // posted-entry immutability invariant (which protects Debit/Credit/AccountId/etc., the actual
    // accounting facts) while everything else on a Posted line stays locked.
    private static bool OnlyReconciliationFieldsChanged(EntityEntry<JournalEntryLine> entry) =>
        entry.Properties.Where(p => p.IsModified).All(p =>
            p.Metadata.Name is nameof(JournalEntryLine.ReconciledFlag) or nameof(JournalEntryLine.ReconciliationId));

    // R16 (storno): JournalEntry.Reverse() transitions a Posted entry straight to Cancelled —
    // the one Posted-state mutation this repo allows, since it's how a correction actually
    // happens (the entry itself never gets un-posted or edited, State is the only field that
    // moves). Everything else about a Posted entry stays locked.
    private static bool OnlyStateChangedToCancelled(EntityEntry<JournalEntry> entry) =>
        entry.Properties.Where(p => p.IsModified).All(p => p.Metadata.Name == nameof(JournalEntry.State)) &&
        entry.CurrentValues.GetValue<JournalEntryState>(nameof(JournalEntry.State)) == JournalEntryState.Cancelled;

    // B15: securing a journal's hash chain (JournalsController.Secure) sets EntryHash/PrevHash/
    // SecureSequenceNumber on an already-Posted entry — the other Posted-state mutation this repo
    // allows besides the storno transition above. Only permitted going from unset to set (all
    // three originally null) — once set, any further attempt to modify them fails this check and
    // is rejected like any other Posted-entry edit, which is exactly the "freeze once hashed"
    // guarantee: a securing run can never re-hash or silently overwrite an already-secured entry.
    private static bool OnlyHashFieldsSecured(EntityEntry<JournalEntry> entry) =>
        entry.Properties.Where(p => p.IsModified).All(p =>
            p.Metadata.Name is nameof(JournalEntry.EntryHash) or nameof(JournalEntry.PrevHash) or nameof(JournalEntry.SecureSequenceNumber)) &&
        entry.OriginalValues.GetValue<string?>(nameof(JournalEntry.EntryHash)) is null &&
        entry.OriginalValues.GetValue<string?>(nameof(JournalEntry.PrevHash)) is null &&
        entry.OriginalValues.GetValue<long?>(nameof(JournalEntry.SecureSequenceNumber)) is null;

    // A5 (v2 release): DueDate/InternalNotes are the one whitelist of fields a Posted Invoice/Bill
    // may still change — everything else (amounts, VAT, partner, lines) goes through a return or
    // a storno. This is the backstop half of a two-layer guard; InvoicesController.Update/
    // BillsController.Update do the primary check (compare every field, reject with a clean 400
    // before ever touching the tracked entity if anything else differs) — this only fires if that
    // check were ever bypassed or buggy, same relationship every other invariant in this repo has
    // between its controller-level check and its DB/EF-level backstop.
    //
    // B5: InvoiceNumber joins the Invoice-only whitelist — NumberSeriesController.OverrideInvoiceNumber
    // is the one legitimate way a Posted invoice's number ever changes (behind
    // Company.AllowNumberOverride, a uniqueness check, and a DocumentNumberAudit row), and until
    // this was added, that endpoint's own SaveChangesAsync threw PostedInvoiceImmutableException
    // every time — a real, previously-untested bug this fix closes.
    // HR module: paying a Posted payroll run (PayrollRun.Pay) moves it to Paid and records the
    // payment entry — the one mutation a Posted run allows. Everything about the accrual stays
    // locked, and a Paid run allows nothing.
    private static bool OnlyPaymentRecorded(EntityEntry<PayrollRun> entry) =>
        entry.OriginalValues.GetValue<PayrollRunState>(nameof(PayrollRun.State)) == PayrollRunState.Posted &&
        entry.CurrentValues.GetValue<PayrollRunState>(nameof(PayrollRun.State)) == PayrollRunState.Paid &&
        entry.Properties.Where(p => p.IsModified).All(p =>
            p.Metadata.Name is nameof(PayrollRun.State) or nameof(PayrollRun.PaymentJournalEntryId) or nameof(PayrollRun.PaidOn));

    private static bool OnlyDueDateOrInternalNotesChanged(EntityEntry<Invoice> entry) =>
        entry.Properties.Where(p => p.IsModified).All(p =>
            p.Metadata.Name is nameof(Invoice.DueDate) or nameof(Invoice.InternalNotes) or nameof(Invoice.InvoiceNumber));

    private static bool OnlyDueDateOrInternalNotesChanged(EntityEntry<Bill> entry) =>
        entry.Properties.Where(p => p.IsModified).All(p =>
            p.Metadata.Name is nameof(Bill.DueDate) or nameof(Bill.InternalNotes));

    private void ValidateImmutability()
    {
        foreach (var entry in ChangeTracker.Entries<JournalEntry>())
        {
            if (entry.State == EntityState.Deleted ||
                (entry.State == EntityState.Modified && !OnlyStateChangedToCancelled(entry) && !OnlyHashFieldsSecured(entry)))
            {
                if (entry.OriginalValues.GetValue<JournalEntryState>(nameof(JournalEntry.State)) == JournalEntryState.Posted)
                {
                    throw new PostedJournalEntryImmutableException(entry.Entity.Id);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<JournalEntryLine>())
        {
            if (entry.State is EntityState.Deleted || (entry.State == EntityState.Modified && !OnlyReconciliationFieldsChanged(entry)))
            {
                var parentState = JournalEntries.AsNoTracking()
                    .Where(e => e.Id == entry.Entity.JournalEntryId)
                    .Select(e => e.State)
                    .FirstOrDefault();
                if (parentState == JournalEntryState.Posted)
                {
                    throw new PostedJournalEntryImmutableException(entry.Entity.JournalEntryId);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<Invoice>())
        {
            if (entry.State == EntityState.Deleted ||
                (entry.State == EntityState.Modified && !OnlyDueDateOrInternalNotesChanged(entry)))
            {
                if (entry.OriginalValues.GetValue<InvoiceState>(nameof(Invoice.State)) == InvoiceState.Posted)
                {
                    throw new PostedInvoiceImmutableException(entry.Entity.Id);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<InvoiceLine>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted)
            {
                var parentState = Invoices.AsNoTracking()
                    .Where(i => i.Id == entry.Entity.InvoiceId)
                    .Select(i => i.State)
                    .FirstOrDefault();
                if (parentState == InvoiceState.Posted)
                {
                    throw new PostedInvoiceImmutableException(entry.Entity.InvoiceId);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<Bill>())
        {
            if (entry.State == EntityState.Deleted ||
                (entry.State == EntityState.Modified && !OnlyDueDateOrInternalNotesChanged(entry)))
            {
                if (entry.OriginalValues.GetValue<BillState>(nameof(Bill.State)) == BillState.Posted)
                {
                    throw new PostedBillImmutableException(entry.Entity.Id);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<BillLine>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted)
            {
                var parentState = Bills.AsNoTracking()
                    .Where(b => b.Id == entry.Entity.BillId)
                    .Select(b => b.State)
                    .FirstOrDefault();
                if (parentState == BillState.Posted)
                {
                    throw new PostedBillImmutableException(entry.Entity.BillId);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<PayrollRun>())
        {
            var originalState = entry.OriginalValues.GetValue<PayrollRunState>(nameof(PayrollRun.State));
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                originalState is PayrollRunState.Posted or PayrollRunState.Paid &&
                !(entry.State == EntityState.Modified && OnlyPaymentRecorded(entry)))
            {
                throw new PostedPayrollRunImmutableException(entry.Entity.Id);
            }
        }

        foreach (var entry in ChangeTracker.Entries<PayslipLine>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted)
            {
                var parentState = PayrollRuns.AsNoTracking()
                    .Where(r => r.Id == entry.Entity.PayrollRunId)
                    .Select(r => r.State)
                    .FirstOrDefault();
                if (parentState is PayrollRunState.Posted or PayrollRunState.Paid)
                {
                    throw new PostedPayrollRunImmutableException(entry.Entity.PayrollRunId);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<PayrollAdjustment>())
        {
            var runId = entry.OriginalValues.GetValue<Guid?>(nameof(PayrollAdjustment.PayrollRunId));
            if (entry.State is EntityState.Modified or EntityState.Deleted && runId is not null)
            {
                var parentState = PayrollRuns.AsNoTracking()
                    .Where(r => r.Id == runId)
                    .Select(r => r.State)
                    .FirstOrDefault();
                if (parentState is PayrollRunState.Posted or PayrollRunState.Paid)
                {
                    throw new PostedPayrollRunImmutableException(runId.Value);
                }
            }
        }
    }

    private async Task ValidateImmutabilityAsync(CancellationToken cancellationToken)
    {
        foreach (var entry in ChangeTracker.Entries<JournalEntry>())
        {
            if (entry.State == EntityState.Deleted ||
                (entry.State == EntityState.Modified && !OnlyStateChangedToCancelled(entry) && !OnlyHashFieldsSecured(entry)))
            {
                if (entry.OriginalValues.GetValue<JournalEntryState>(nameof(JournalEntry.State)) == JournalEntryState.Posted)
                {
                    throw new PostedJournalEntryImmutableException(entry.Entity.Id);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<JournalEntryLine>())
        {
            if (entry.State is EntityState.Deleted || (entry.State == EntityState.Modified && !OnlyReconciliationFieldsChanged(entry)))
            {
                var parentState = await JournalEntries.AsNoTracking()
                    .Where(e => e.Id == entry.Entity.JournalEntryId)
                    .Select(e => e.State)
                    .FirstOrDefaultAsync(cancellationToken);
                if (parentState == JournalEntryState.Posted)
                {
                    throw new PostedJournalEntryImmutableException(entry.Entity.JournalEntryId);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<Invoice>())
        {
            if (entry.State == EntityState.Deleted ||
                (entry.State == EntityState.Modified && !OnlyDueDateOrInternalNotesChanged(entry)))
            {
                if (entry.OriginalValues.GetValue<InvoiceState>(nameof(Invoice.State)) == InvoiceState.Posted)
                {
                    throw new PostedInvoiceImmutableException(entry.Entity.Id);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<InvoiceLine>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted)
            {
                var parentState = await Invoices.AsNoTracking()
                    .Where(i => i.Id == entry.Entity.InvoiceId)
                    .Select(i => i.State)
                    .FirstOrDefaultAsync(cancellationToken);
                if (parentState == InvoiceState.Posted)
                {
                    throw new PostedInvoiceImmutableException(entry.Entity.InvoiceId);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<Bill>())
        {
            if (entry.State == EntityState.Deleted ||
                (entry.State == EntityState.Modified && !OnlyDueDateOrInternalNotesChanged(entry)))
            {
                if (entry.OriginalValues.GetValue<BillState>(nameof(Bill.State)) == BillState.Posted)
                {
                    throw new PostedBillImmutableException(entry.Entity.Id);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<BillLine>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted)
            {
                var parentState = await Bills.AsNoTracking()
                    .Where(b => b.Id == entry.Entity.BillId)
                    .Select(b => b.State)
                    .FirstOrDefaultAsync(cancellationToken);
                if (parentState == BillState.Posted)
                {
                    throw new PostedBillImmutableException(entry.Entity.BillId);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<PayrollRun>())
        {
            var originalState = entry.OriginalValues.GetValue<PayrollRunState>(nameof(PayrollRun.State));
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                originalState is PayrollRunState.Posted or PayrollRunState.Paid &&
                !(entry.State == EntityState.Modified && OnlyPaymentRecorded(entry)))
            {
                throw new PostedPayrollRunImmutableException(entry.Entity.Id);
            }
        }

        foreach (var entry in ChangeTracker.Entries<PayslipLine>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted)
            {
                var parentState = await PayrollRuns.AsNoTracking()
                    .Where(r => r.Id == entry.Entity.PayrollRunId)
                    .Select(r => r.State)
                    .FirstOrDefaultAsync(cancellationToken);
                if (parentState is PayrollRunState.Posted or PayrollRunState.Paid)
                {
                    throw new PostedPayrollRunImmutableException(entry.Entity.PayrollRunId);
                }
            }
        }

        foreach (var entry in ChangeTracker.Entries<PayrollAdjustment>())
        {
            var runId = entry.OriginalValues.GetValue<Guid?>(nameof(PayrollAdjustment.PayrollRunId));
            if (entry.State is EntityState.Modified or EntityState.Deleted && runId is not null)
            {
                var parentState = await PayrollRuns.AsNoTracking()
                    .Where(r => r.Id == runId)
                    .Select(r => r.State)
                    .FirstOrDefaultAsync(cancellationToken);
                if (parentState is PayrollRunState.Posted or PayrollRunState.Paid)
                {
                    throw new PostedPayrollRunImmutableException(runId.Value);
                }
            }
        }
    }
}
