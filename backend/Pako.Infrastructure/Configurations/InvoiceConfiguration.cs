using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Invoicing;

namespace Pako.Infrastructure.Configurations;

public class InvoiceConfiguration : IEntityTypeConfiguration<Invoice>
{
    public void Configure(EntityTypeBuilder<Invoice> builder)
    {
        builder.ToTable("invoices");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(i => i.InvoiceNumber).HasMaxLength(64);
        builder.Property(i => i.PriceMode).HasDefaultValue(PriceMode.GrossInclusive);
        builder.Property(i => i.InternalNotes).HasMaxLength(1000);
        builder.HasMany(i => i.Lines)
            .WithOne(l => l.Invoice)
            .HasForeignKey(l => l.InvoiceId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(i => new { i.CompanyId, i.InvoiceNumber }).IsUnique().HasFilter("\"InvoiceNumber\" IS NOT NULL");
        builder.HasIndex(i => new { i.CompanyId, i.State });
        builder.HasOne<Invoice>().WithMany().HasForeignKey(i => i.OriginalInvoiceId).OnDelete(DeleteBehavior.Restrict);
    }
}
