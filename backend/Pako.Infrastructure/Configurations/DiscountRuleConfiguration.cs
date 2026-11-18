using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;

namespace Pako.Infrastructure.Configurations;

public class DiscountRuleConfiguration : IEntityTypeConfiguration<DiscountRule>
{
    public void Configure(EntityTypeBuilder<DiscountRule> builder)
    {
        builder.ToTable("discount_rules");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Name).IsRequired().HasMaxLength(128);
        builder.Property(r => r.Percent).HasColumnType("numeric(5,2)");
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Cascade);
        // A rule follows its target: deleting a category or item removes the rules aimed at it.
        builder.HasOne<Partner>().WithMany().HasForeignKey(r => r.PartnerId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ItemCategory>().WithMany().HasForeignKey(r => r.ItemCategoryId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Item>().WithMany().HasForeignKey(r => r.ItemId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(r => new { r.CompanyId, r.ValidFrom, r.ValidTo });
    }
}
