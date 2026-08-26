using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Bills;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;

namespace Pako.Infrastructure.Configurations;

public class ReconciliationConfiguration : IEntityTypeConfiguration<Reconciliation>
{
    public void Configure(EntityTypeBuilder<Reconciliation> builder)
    {
        builder.ToTable("reconciliations");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Amount).HasColumnType("numeric(18,2)");
        builder.HasOne<Invoice>().WithMany().HasForeignKey(r => r.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Bill>().WithMany().HasForeignKey(r => r.BillId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<JournalEntryLine>().WithMany().HasForeignKey(r => r.JournalEntryLineId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(r => r.InvoiceId);
        builder.HasIndex(r => r.BillId);
        builder.HasIndex(r => r.JournalEntryLineId);
    }
}
