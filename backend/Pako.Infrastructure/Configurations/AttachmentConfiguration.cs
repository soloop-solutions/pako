using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Attachments;

namespace Pako.Infrastructure.Configurations;

public class AttachmentConfiguration : IEntityTypeConfiguration<Attachment>
{
    public void Configure(EntityTypeBuilder<Attachment> builder)
    {
        builder.ToTable("attachments");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.FileName).IsRequired().HasMaxLength(256);
        builder.Property(a => a.ContentType).IsRequired().HasMaxLength(128);
        builder.Property(a => a.Content).IsRequired();
        builder.HasIndex(a => new { a.CompanyId, a.OwnerType, a.OwnerId });
    }
}
