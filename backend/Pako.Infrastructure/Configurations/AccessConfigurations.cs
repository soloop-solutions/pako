using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Companies;

namespace Pako.Infrastructure.Configurations;

public class CompanyRoleConfiguration : IEntityTypeConfiguration<CompanyRole>
{
    public void Configure(EntityTypeBuilder<CompanyRole> builder)
    {
        builder.ToTable("company_roles");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Name).IsRequired().HasMaxLength(80);
        builder.Property(r => r.Description).HasMaxLength(300);
        builder.Property(r => r.BuiltInKey).HasMaxLength(32);
        builder.Ignore(r => r.CanManageUsers);
        // Same storage as Department's levels: readable strings ("None", "Read", "Write", "Approve").
        builder.Property(r => r.SalesAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.PurchasesAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.PartnersAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.ItemsAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.AccountingAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.ReportsAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.HrAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.PayrollAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.SettingsAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.UsersAccess).HasConversion<string>().HasMaxLength(8);
        builder.Property(r => r.PartnerScope).HasConversion<string>().HasMaxLength(16);
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(r => new { r.CompanyId, r.Name }).IsUnique();
        builder.HasIndex(r => new { r.CompanyId, r.BuiltInKey }).IsUnique().HasFilter("\"BuiltInKey\" IS NOT NULL");
    }
}

public class UserInvitationConfiguration : IEntityTypeConfiguration<UserInvitation>
{
    public void Configure(EntityTypeBuilder<UserInvitation> builder)
    {
        builder.ToTable("user_invitations");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.Email).IsRequired().HasMaxLength(256);
        builder.Property(i => i.FullName).HasMaxLength(160);
        builder.Property(i => i.TokenHash).IsRequired().HasMaxLength(64);
        builder.Property(i => i.Role).HasConversion<string>().HasMaxLength(32);
        builder.HasOne<Company>().WithMany().HasForeignKey(i => i.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<CompanyRole>().WithMany().HasForeignKey(i => i.CompanyRoleId).OnDelete(DeleteBehavior.SetNull);
        builder.HasIndex(i => i.TokenHash).IsUnique();
        builder.HasIndex(i => new { i.CompanyId, i.Email });
    }
}
