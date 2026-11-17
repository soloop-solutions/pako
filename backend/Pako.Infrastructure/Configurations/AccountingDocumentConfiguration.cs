using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Documents;

namespace Pako.Infrastructure.Configurations;

public class AccountingDocumentConfiguration : IEntityTypeConfiguration<AccountingDocument>
{
    public void Configure(EntityTypeBuilder<AccountingDocument> builder)
    {
        builder.ToTable("accounting_documents");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Name).IsRequired().HasMaxLength(256);
        builder.Property(a => a.FileName).IsRequired().HasMaxLength(256);
        builder.Property(a => a.ContentType).IsRequired().HasMaxLength(128);
        builder.Property(a => a.Content).IsRequired();
        builder.Property(a => a.DocumentType).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(a => new { a.CompanyId, a.Year, a.Month, a.DocumentType });
    }
}
