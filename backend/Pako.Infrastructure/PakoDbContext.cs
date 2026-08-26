using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
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
    public DbSet<Firm> Firms => Set<Firm>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Partner> Partners => Set<Partner>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<Journal> Journals => Set<Journal>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalEntryLine> JournalEntryLines => Set<JournalEntryLine>();
    public DbSet<TaxDefinition> TaxDefinitions => Set<TaxDefinition>();
    public DbSet<TaxRepartitionLine> TaxRepartitionLines => Set<TaxRepartitionLine>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
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

    private void ValidateImmutability()
    {
        foreach (var entry in ChangeTracker.Entries<JournalEntry>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.OriginalValues.GetValue<JournalEntryState>(nameof(JournalEntry.State)) == JournalEntryState.Posted)
            {
                throw new PostedJournalEntryImmutableException(entry.Entity.Id);
            }
        }

        foreach (var entry in ChangeTracker.Entries<JournalEntryLine>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted)
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
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.OriginalValues.GetValue<InvoiceState>(nameof(Invoice.State)) == InvoiceState.Posted)
            {
                throw new PostedInvoiceImmutableException(entry.Entity.Id);
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
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.OriginalValues.GetValue<BillState>(nameof(Bill.State)) == BillState.Posted)
            {
                throw new PostedBillImmutableException(entry.Entity.Id);
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
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.OriginalValues.GetValue<JournalEntryState>(nameof(JournalEntry.State)) == JournalEntryState.Posted)
            {
                throw new PostedJournalEntryImmutableException(entry.Entity.Id);
            }
        }

        foreach (var entry in ChangeTracker.Entries<JournalEntryLine>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted)
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
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.OriginalValues.GetValue<InvoiceState>(nameof(Invoice.State)) == InvoiceState.Posted)
            {
                throw new PostedInvoiceImmutableException(entry.Entity.Id);
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
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.OriginalValues.GetValue<BillState>(nameof(Bill.State)) == BillState.Posted)
            {
                throw new PostedBillImmutableException(entry.Entity.Id);
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
