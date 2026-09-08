using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class ItemBarcodeConfiguration : IEntityTypeConfiguration<ItemBarcode>
{
    public void Configure(EntityTypeBuilder<ItemBarcode> builder)
    {
        builder.ToTable("item_barcodes");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Barcode).IsRequired().HasMaxLength(64);
        builder.HasIndex(b => new { b.CompanyId, b.Barcode }).IsUnique();
    }
}
