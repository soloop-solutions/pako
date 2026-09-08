using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Bills;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class BillLineConfiguration : IEntityTypeConfiguration<BillLine>
{
    public void Configure(EntityTypeBuilder<BillLine> builder)
    {
        builder.ToTable("bill_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).HasMaxLength(512);
        builder.Property(l => l.Quantity).HasColumnType("numeric(18,4)");
        builder.Property(l => l.UnitPrice).HasColumnType("numeric(18,2)");
        builder.HasIndex(l => l.ExpenseAccountId);
        builder.HasOne<Item>().WithMany().HasForeignKey(l => l.ItemId).OnDelete(DeleteBehavior.Restrict);
    }
}
