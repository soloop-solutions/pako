using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Bills;

namespace Pako.Infrastructure.Configurations;

public class BillConfiguration : IEntityTypeConfiguration<Bill>
{
    public void Configure(EntityTypeBuilder<Bill> builder)
    {
        builder.ToTable("bills");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(b => b.VendorReference).HasMaxLength(128);
        builder.HasMany(b => b.Lines)
            .WithOne(l => l.Bill)
            .HasForeignKey(l => l.BillId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(b => new { b.CompanyId, b.State });
        builder.HasOne<Bill>().WithMany().HasForeignKey(b => b.OriginalBillId).OnDelete(DeleteBehavior.Restrict);
    }
}
