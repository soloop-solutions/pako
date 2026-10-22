using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Shared;

namespace Pako.Infrastructure.Configurations;

public class UserFavoriteConfiguration : IEntityTypeConfiguration<UserFavorite>
{
    public void Configure(EntityTypeBuilder<UserFavorite> builder)
    {
        builder.ToTable("user_favorites");
        builder.HasKey(f => f.Id);

        builder.Property(f => f.EntityType).IsRequired().HasMaxLength(50);
        builder.Property(f => f.SelectionCount).HasDefaultValue(0);
        builder.Property(f => f.IsPinned).HasDefaultValue(false);
        builder.Property(f => f.IsSuppressed).HasDefaultValue(false);

        // One row per user+company+type+entity — prevents duplicates
        builder.HasIndex(f => new { f.UserId, f.CompanyId, f.EntityType, f.EntityId })
            .IsUnique();

        // Fast lookup: all favorites for a user in a company for a given type
        builder.HasIndex(f => new { f.UserId, f.CompanyId, f.EntityType });
    }
}
