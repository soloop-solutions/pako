using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Assets;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;

namespace Pako.Infrastructure.Configurations;

public class AssetCategoryConfiguration : IEntityTypeConfiguration<AssetCategory>
{
    public void Configure(EntityTypeBuilder<AssetCategory> builder)
    {
        builder.ToTable("asset_categories");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Name).IsRequired().HasMaxLength(128);
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Account>().WithMany().HasForeignKey(c => c.AssetAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Account>().WithMany().HasForeignKey(c => c.AccumulatedDepreciationAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Account>().WithMany().HasForeignKey(c => c.DepreciationExpenseAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(c => new { c.CompanyId, c.Name }).IsUnique();
    }
}

public class FixedAssetConfiguration : IEntityTypeConfiguration<FixedAsset>
{
    public void Configure(EntityTypeBuilder<FixedAsset> builder)
    {
        builder.ToTable("fixed_assets");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Code).IsRequired().HasMaxLength(32);
        builder.Property(a => a.Name).IsRequired().HasMaxLength(256);
        builder.Property(a => a.SerialNumber).HasMaxLength(128);
        builder.Property(a => a.Location).HasMaxLength(128);
        builder.Property(a => a.Notes).HasMaxLength(2000);
        builder.Property(a => a.Cost).HasColumnType("numeric(18,2)");
        builder.Property(a => a.ResidualValue).HasColumnType("numeric(18,2)");
        builder.Property(a => a.OpeningAccumulatedDepreciation).HasColumnType("numeric(18,2)");
        builder.Property(a => a.DisposalProceeds).HasColumnType("numeric(18,2)");
        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<AssetCategory>().WithMany().HasForeignKey(a => a.CategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<JournalEntry>().WithMany().HasForeignKey(a => a.DisposalJournalEntryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => new { a.CompanyId, a.Code }).IsUnique();
        builder.ToTable(t => t.HasCheckConstraint("CK_fixed_assets_amounts",
            "\"Cost\" > 0 AND \"ResidualValue\" >= 0 AND \"ResidualValue\" <= \"Cost\" AND \"OpeningAccumulatedDepreciation\" >= 0 AND \"UsefulLifeMonths\" >= 0"));
    }
}

public class DepreciationRunConfiguration : IEntityTypeConfiguration<DepreciationRun>
{
    public void Configure(EntityTypeBuilder<DepreciationRun> builder)
    {
        builder.ToTable("depreciation_runs");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Total).HasColumnType("numeric(18,2)");
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<JournalEntry>().WithMany().HasForeignKey(r => r.JournalEntryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<JournalEntry>().WithMany().HasForeignKey(r => r.ReversalJournalEntryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(r => r.Lines).WithOne().HasForeignKey(l => l.DepreciationRunId).OnDelete(DeleteBehavior.Cascade);
        // One posted run per month; a reversed run stays as history and frees its month.
        builder.HasIndex(r => new { r.CompanyId, r.Period }).IsUnique().HasFilter("\"State\" = 0");
    }
}

public class DepreciationRunLineConfiguration : IEntityTypeConfiguration<DepreciationRunLine>
{
    public void Configure(EntityTypeBuilder<DepreciationRunLine> builder)
    {
        builder.ToTable("depreciation_run_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Amount).HasColumnType("numeric(18,2)");
        builder.HasOne<FixedAsset>().WithMany().HasForeignKey(l => l.FixedAssetId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => l.FixedAssetId);
    }
}
