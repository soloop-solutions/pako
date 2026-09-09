using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Domain.Reconciliation;
using Pako.Domain.Tax;
using Pako.Infrastructure.Identity;

namespace Pako.Infrastructure;

public class PakoDbContext : IdentityUserContext<AppUser, Guid>
{
    public PakoDbContext(DbContextOptions<PakoDbContext> options) : base(options)
    {
    }

    public DbSet<Company> Companies => Set<Company>();
    public DbSet<CompanyAccountDefaults> CompanyAccountDefaults => Set<CompanyAccountDefaults>();
    public DbSet<Firm> Firms => Set<Firm>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Partner> Partners => Set<Partner>();
    public DbSet<Item> Items => Set<Item>();
    public DbSet<ItemBarcode> ItemBarcodes => Set<ItemBarcode>();
    public DbSet<NumberSeries> NumberSeriesSet => Set<NumberSeries>();
    public DbSet<DocumentNumberAudit> DocumentNumberAudits => Set<DocumentNumberAudit>();
    public DbSet<PaymentMethod> PaymentMethods => Set<PaymentMethod>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<Journal> Journals => Set<Journal>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalEntryLine> JournalEntryLines => Set<JournalEntryLine>();
    public DbSet<CostCenter> CostCenters => Set<CostCenter>();
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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PakoDbContext).Assembly);
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

    // A5 (v2 release): DueDate/InternalNotes are the one whitelist of fields a Posted Invoice/Bill
    // may still change — everything else (amounts, VAT, partner, lines) goes through a return or
    // a storno. This is the backstop half of a two-layer guard; InvoicesController.Update/
    // BillsController.Update do the primary check (compare every field, reject with a clean 400
    // before ever touching the tracked entity if anything else differs) — this only fires if that
    // check were ever bypassed or buggy, same relationship every other invariant in this repo has
    // between its controller-level check and its DB/EF-level backstop.
    private static bool OnlyDueDateOrInternalNotesChanged(EntityEntry<Invoice> entry) =>
        entry.Properties.Where(p => p.IsModified).All(p =>
            p.Metadata.Name is nameof(Invoice.DueDate) or nameof(Invoice.InternalNotes));

    private static bool OnlyDueDateOrInternalNotesChanged(EntityEntry<Bill> entry) =>
        entry.Properties.Where(p => p.IsModified).All(p =>
            p.Metadata.Name is nameof(Bill.DueDate) or nameof(Bill.InternalNotes));

    private void ValidateImmutability()
    {
        foreach (var entry in ChangeTracker.Entries<JournalEntry>())
        {
            if (entry.State == EntityState.Deleted ||
                (entry.State == EntityState.Modified && !OnlyStateChangedToCancelled(entry)))
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
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.OriginalValues.GetValue<PayrollRunState>(nameof(PayrollRun.State)) == PayrollRunState.Posted)
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
                if (parentState == PayrollRunState.Posted)
                {
                    throw new PostedPayrollRunImmutableException(entry.Entity.PayrollRunId);
                }
            }
        }
    }

    private async Task ValidateImmutabilityAsync(CancellationToken cancellationToken)
    {
        foreach (var entry in ChangeTracker.Entries<JournalEntry>())
        {
            if (entry.State == EntityState.Deleted ||
                (entry.State == EntityState.Modified && !OnlyStateChangedToCancelled(entry)))
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
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.OriginalValues.GetValue<PayrollRunState>(nameof(PayrollRun.State)) == PayrollRunState.Posted)
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
                if (parentState == PayrollRunState.Posted)
                {
                    throw new PostedPayrollRunImmutableException(entry.Entity.PayrollRunId);
                }
            }
        }
    }
}
