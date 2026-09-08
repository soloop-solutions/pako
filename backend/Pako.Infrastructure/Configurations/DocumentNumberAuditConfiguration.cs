using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class DocumentNumberAuditConfiguration : IEntityTypeConfiguration<DocumentNumberAudit>
{
    public void Configure(EntityTypeBuilder<DocumentNumberAudit> builder)
    {
        builder.ToTable("document_number_audits");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.OldNumber).HasMaxLength(64);
        builder.Property(a => a.NewNumber).HasMaxLength(64);
        builder.HasIndex(a => new { a.CompanyId, a.DocumentId });
    }
}
