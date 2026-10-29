using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Shared;

namespace Pako.Infrastructure.Configurations;

public class AuditEntryConfiguration : IEntityTypeConfiguration<AuditEntry>
{
    public void Configure(EntityTypeBuilder<AuditEntry> builder)
    {
        builder.ToTable("audit_entries");
        builder.HasKey(a => a.Id);
        builder.HasIndex(a => new { a.CompanyId, a.EntityType, a.EntityId });
        builder.HasIndex(a => new { a.CompanyId, a.OccurredAtUtc });
    }
}
