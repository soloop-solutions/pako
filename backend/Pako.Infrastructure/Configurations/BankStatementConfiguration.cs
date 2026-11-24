using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Pako.Domain.Banking;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;

namespace Pako.Infrastructure.Configurations;

public class BankStatementConfiguration : IEntityTypeConfiguration<BankStatement>
{
    public void Configure(EntityTypeBuilder<BankStatement> builder)
    {
        builder.ToTable("bank_statements");
        builder.HasKey(s => s.Id);
        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Account>().WithMany().HasForeignKey(s => s.BankAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(s => s.FileName).IsRequired().HasMaxLength(256);
        builder.Property(s => s.FileHash).IsRequired().HasMaxLength(64);
        builder.Property(s => s.OpeningBalance).HasColumnType("numeric(18,2)");
        builder.Property(s => s.ClosingBalance).HasColumnType("numeric(18,2)");
        builder.Property(s => s.State).HasConversion<string>().HasMaxLength(16);
        builder.Ignore(s => s.TotalIn);
        builder.Ignore(s => s.TotalOut);
        builder.Ignore(s => s.BalanceDifference);

        builder.HasMany(s => s.Lines).WithOne().HasForeignKey(l => l.StatementId).OnDelete(DeleteBehavior.Cascade);

        // The same file can't be imported twice into one company.
        builder.HasIndex(s => new { s.CompanyId, s.FileHash }).IsUnique();
        builder.HasIndex(s => new { s.CompanyId, s.PeriodFrom });
    }
}

public class BankStatementLineConfiguration : IEntityTypeConfiguration<BankStatementLine>
{
    public void Configure(EntityTypeBuilder<BankStatementLine> builder)
    {
        builder.ToTable("bank_statement_lines");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Description).IsRequired().HasMaxLength(500);
        builder.Property(l => l.PartnerText).HasMaxLength(256);
        builder.Property(l => l.Reference).HasMaxLength(256);
        builder.Property(l => l.AmountIn).HasColumnType("numeric(18,2)");
        builder.Property(l => l.AmountOut).HasColumnType("numeric(18,2)");
        builder.Property(l => l.MatchAmount).HasColumnType("numeric(18,2)");
        builder.Property(l => l.Fingerprint).IsRequired().HasMaxLength(64);
        builder.Property(l => l.State).HasConversion<string>().HasMaxLength(16);
        builder.HasOne<Partner>().WithMany().HasForeignKey(l => l.PartnerId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Invoice>().WithMany().HasForeignKey(l => l.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Bill>().WithMany().HasForeignKey(l => l.BillId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<JournalEntry>().WithMany().HasForeignKey(l => l.JournalEntryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Pako.Domain.Reconciliation.Reconciliation>().WithMany().HasForeignKey(l => l.ReconciliationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Pako.Domain.Payments.Payment>().WithMany().HasForeignKey(l => l.PaymentId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Account>().WithMany().HasForeignKey(l => l.DirectAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.Ignore(l => l.IsIncoming);
        builder.Ignore(l => l.Amount);
        builder.Ignore(l => l.HasMatch);

        builder.HasIndex(l => new { l.StatementId, l.RowNumber });
        builder.HasIndex(l => l.Fingerprint);
    }
}
