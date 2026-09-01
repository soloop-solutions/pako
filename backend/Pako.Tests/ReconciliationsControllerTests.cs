using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

// Controller-level tests (real ReconciliationsController against an InMemory PakoDbContext, same
// pattern as ReportsControllerTests/FirmsAndMembershipTests) rather than only ReconciliationValidatorTests,
// because the double-spend bug lived in how the controller summed "already reconciled for this
// line" from real Reconciliation rows across two different documents — a pure unit test of the
// validator alone can't reproduce that.
public class ReconciliationsControllerTests
{
    private static readonly TaxComputationService TaxService = new();

    private static PakoDbContext NewContext() =>
        new(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static (Invoice Invoice, JournalEntry JournalEntry) PostedInvoice(
        Company company, Guid partnerId, Guid revenueAccountId, Guid receivableAccountId, decimal unitPrice)
    {
        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = partnerId,
            IssueDate = new DateOnly(2026, 8, 26),
            DueDate = new DateOnly(2026, 9, 25),
            Lines = { new InvoiceLine { Id = Guid.NewGuid(), Description = "Line", Quantity = 1m, UnitPrice = unitPrice, RevenueAccountId = revenueAccountId } }
        };
        var journalEntry = invoice.Post(company, Guid.NewGuid(), receivableAccountId, TaxService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        return (invoice, journalEntry);
    }

    private static JournalEntry PostedCashReceipt(Company company, Guid cashAccountId, Guid receivableAccountId, Guid partnerId, decimal amount)
    {
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = Guid.NewGuid(),
            Date = new DateOnly(2026, 8, 26),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = cashAccountId, Debit = amount, Credit = 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = receivableAccountId, PartnerId = partnerId, Debit = 0m, Credit = amount }
            }
        };
        entry.Post(company);
        return entry;
    }

    private static async Task<(PakoDbContext Db, Company Company, Guid PartnerId, Guid RevenueAccountId, Guid ReceivableAccountId, Guid CashAccountId)> SeedAsync()
    {
        var db = NewContext();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var partnerId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();
        var cashAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Acme", IsCustomer = true });
        db.Accounts.Add(new Account { Id = receivableAccountId, CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = cashAccountId, CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = revenueAccountId, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = receivableAccountId,
            PayableAccountId = Guid.NewGuid(),
            RevenueAccountId = revenueAccountId,
            ExpenseAccountId = Guid.NewGuid(),
            CustomerDepositsAccountId = Guid.NewGuid()
        });
        await db.SaveChangesAsync();

        return (db, company, partnerId, revenueAccountId, receivableAccountId, cashAccountId);
    }

    [Fact]
    public async Task Create_SameSettlementLineReconciledAgainstTwoDifferentInvoices_SecondAttemptRejected()
    {
        var (db, company, partnerId, revenueAccountId, receivableAccountId, cashAccountId) = await SeedAsync();

        var (invoiceA, journalEntryA) = PostedInvoice(company, partnerId, revenueAccountId, receivableAccountId, 1000m);
        var (invoiceB, journalEntryB) = PostedInvoice(company, partnerId, revenueAccountId, receivableAccountId, 1000m);
        db.Invoices.AddRange(invoiceA, invoiceB);
        db.JournalEntries.AddRange(journalEntryA, journalEntryB);
        await db.SaveChangesAsync();

        var receipt = PostedCashReceipt(company, cashAccountId, receivableAccountId, partnerId, 100m);
        db.JournalEntries.Add(receipt);
        await db.SaveChangesAsync();

        var settlementLineId = receipt.Lines.Single(l => l.AccountId == receivableAccountId).Id;
        var controller = new ReconciliationsController(db);

        var first = await controller.Create(company.Id, new CreateReconciliationRequest(invoiceA.Id, null, settlementLineId, 100m));
        Assert.IsType<ObjectResult>(first.Result);
        Assert.Equal(201, ((ObjectResult)first.Result!).StatusCode);

        var second = await controller.Create(company.Id, new CreateReconciliationRequest(invoiceB.Id, null, settlementLineId, 100m));
        var badRequest = Assert.IsType<BadRequestObjectResult>(second.Result);
        Assert.Contains("100", badRequest.Value!.ToString());

        var line = await db.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == settlementLineId);
        Assert.True(line.ReconciledFlag);
    }

    [Fact]
    public async Task Create_OneSettlementLineSplitAcrossThreeInvoices_AllSucceed()
    {
        var (db, company, partnerId, revenueAccountId, receivableAccountId, cashAccountId) = await SeedAsync();

        var (invoiceA, journalEntryA) = PostedInvoice(company, partnerId, revenueAccountId, receivableAccountId, 1000m);
        var (invoiceB, journalEntryB) = PostedInvoice(company, partnerId, revenueAccountId, receivableAccountId, 1000m);
        var (invoiceC, journalEntryC) = PostedInvoice(company, partnerId, revenueAccountId, receivableAccountId, 1000m);
        db.Invoices.AddRange(invoiceA, invoiceB, invoiceC);
        db.JournalEntries.AddRange(journalEntryA, journalEntryB, journalEntryC);
        await db.SaveChangesAsync();

        var receipt = PostedCashReceipt(company, cashAccountId, receivableAccountId, partnerId, 250m);
        db.JournalEntries.Add(receipt);
        await db.SaveChangesAsync();

        var settlementLineId = receipt.Lines.Single(l => l.AccountId == receivableAccountId).Id;
        var controller = new ReconciliationsController(db);

        var r1 = await controller.Create(company.Id, new CreateReconciliationRequest(invoiceA.Id, null, settlementLineId, 100m));
        var r2 = await controller.Create(company.Id, new CreateReconciliationRequest(invoiceB.Id, null, settlementLineId, 100m));
        var r3 = await controller.Create(company.Id, new CreateReconciliationRequest(invoiceC.Id, null, settlementLineId, 50m));

        Assert.Equal(201, ((ObjectResult)r1.Result!).StatusCode);
        Assert.Equal(201, ((ObjectResult)r2.Result!).StatusCode);
        Assert.Equal(201, ((ObjectResult)r3.Result!).StatusCode);

        var line = await db.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == settlementLineId);
        Assert.True(line.ReconciledFlag);
    }
}
