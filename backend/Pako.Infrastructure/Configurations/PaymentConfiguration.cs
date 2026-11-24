using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payments;

namespace Pako.Infrastructure.Configurations;

public class PaymentConfiguration : IEntityTypeConfiguration<Payment>
{
    public void Configure(EntityTypeBuilder<Payment> builder)
    {
        builder.ToTable("payments");
        builder.HasKey(p => p.Id);
        builder.HasOne<Company>().WithMany().HasForeignKey(p => p.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Partner>().WithMany().HasForeignKey(p => p.PartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(p => p.Amount).HasColumnType("numeric(18,2)");
        builder.Property(p => p.Reference).HasMaxLength(500);
        builder.Property(p => p.Direction).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.CreatedByUserId).HasMaxLength(64);
        builder.HasOne<JournalEntry>().WithMany().HasForeignKey(p => p.JournalEntryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<JournalEntry>().WithMany().HasForeignKey(p => p.ClearingJournalEntryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Invoice>().WithMany().HasForeignKey(p => p.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Bill>().WithMany().HasForeignKey(p => p.BillId).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(p => new { p.CompanyId, p.State });
        builder.HasIndex(p => p.InvoiceId).HasFilter("\"InvoiceId\" IS NOT NULL");
        builder.HasIndex(p => p.BillId).HasFilter("\"BillId\" IS NOT NULL");
    }
}
