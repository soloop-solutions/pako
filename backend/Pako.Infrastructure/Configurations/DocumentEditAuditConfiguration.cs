using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Invoicing;

namespace Pako.Infrastructure.Configurations;

public class DocumentEditAuditConfiguration : IEntityTypeConfiguration<DocumentEditAudit>
{
    public void Configure(EntityTypeBuilder<DocumentEditAudit> builder)
    {
        builder.ToTable("document_edit_audits");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.OldInternalNotes).HasMaxLength(1000);
        builder.Property(a => a.NewInternalNotes).HasMaxLength(1000);
        builder.HasIndex(a => new { a.CompanyId, a.DocumentId });
    }
}
