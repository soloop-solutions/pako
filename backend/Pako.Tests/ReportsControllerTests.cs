using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Tests;

public class ReportsControllerTests
{
    private static PakoDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PakoDbContext(options);
    }

    private static async Task<(PakoDbContext Db, Guid CompanyId)> SeedMixedScenario()
    {
        var db = NewContext();
        var taxComputationService = new TaxComputationService();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };

        var accountIdsByCode = new Dictionary<string, Guid>();
        foreach (var entry in DefaultChartOfAccountsTemplate.Entries)
        {
            var accountId = Guid.NewGuid();
            accountIdsByCode[entry.Code] = accountId;
            db.Accounts.Add(new Account
            {
                Id = accountId,
                CompanyId = company.Id,
                Code = entry.Code,
                Name = entry.Name,
                AccountType = entry.AccountType,
                AccountSubType = entry.AccountSubType
            });
        }

        var taxDefinitions = DefaultTaxDefinitionsTemplate.CreateDefaultTaxDefinitions(company.Id, accountIdsByCode);
        db.TaxDefinitions.AddRange(taxDefinitions);
        var taxDefinitionsById = taxDefinitions.ToDictionary(t => t.Id);
        var vatOnSales = taxDefinitions.Single(t => t.Name == "VAT 18% (Sales)");
        var vatOnPurchases = taxDefinitions.Single(t => t.Name == "VAT 18% (Purchases)");

        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Journals.Add(journal);

        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Customer Co", IsCustomer = true };
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Vendor Co", IsVendor = true };
        db.Partners.AddRange(customer, vendor);

        var capitalEntry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = journal.Id,
            Date = new DateOnly(2026, 1, 1),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountIdsByCode["1000"], Debit = 1000m, Credit = 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountIdsByCode["3000"], Debit = 0m, Credit = 1000m }
            }
        };
        capitalEntry.Post(company);
        db.JournalEntries.Add(capitalEntry);

        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = customer.Id,
            IssueDate = new DateOnly(2026, 2, 1),
            DueDate = new DateOnly(2026, 3, 3),
            Lines =
            {
                new InvoiceLine
                {
                    Id = Guid.NewGuid(),
                    Description = "Consulting",
                    Quantity = 1m,
                    UnitPrice = 1000m,
                    RevenueAccountId = accountIdsByCode["4000"],
                    TaxDefinitionId = vatOnSales.Id
                }
            }
        };
        var invoiceEntry = invoice.Post(
            company, journal.Id, accountIdsByCode["1200"], taxComputationService, taxDefinitionsById);
        db.Invoices.Add(invoice);
        db.JournalEntries.Add(invoiceEntry);

        var bill = new Bill
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = vendor.Id,
            VendorReference = "SUPPLIER-1",
            IssueDate = new DateOnly(2026, 3, 1),
            DueDate = new DateOnly(2026, 3, 31),
            Lines =
            {
                new BillLine
                {
                    Id = Guid.NewGuid(),
                    Description = "Office rent",
                    Quantity = 1m,
                    UnitPrice = 400m,
                    ExpenseAccountId = accountIdsByCode["6000"],
                    TaxDefinitionId = vatOnPurchases.Id
                }
            }
        };
        var billEntry = bill.Post(
            company, journal.Id, accountIdsByCode["2000"], taxComputationService, taxDefinitionsById);
        db.Bills.Add(bill);
        db.JournalEntries.Add(billEntry);

        db.Companies.Add(company);
        await db.SaveChangesAsync();

        return (db, company.Id);
    }

    [Fact]
    public async Task ProfitAndLoss_SplitsIncomeAndExpensesAndComputesNetIncome()
    {
        var (db, companyId) = await SeedMixedScenario();
        var controller = new ReportsController(db);

        var result = await controller.ProfitAndLoss(companyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

        var body = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<ProfitAndLossResponse>(body.Value);

        var revenue = Assert.Single(response.Income);
        Assert.Equal("4000", revenue.AccountCode);
        Assert.Equal(1000m, revenue.Amount);

        var expense = Assert.Single(response.Expenses);
        Assert.Equal("6000", expense.AccountCode);
        Assert.Equal(400m, expense.Amount);

        Assert.Equal(1000m, response.TotalIncome);
        Assert.Equal(400m, response.TotalExpenses);
        Assert.Equal(600m, response.NetIncome);
    }

    [Fact]
    public async Task BalanceSheet_AssetsEqualLiabilitiesPlusEquity_ForMixedScenario()
    {
        var (db, companyId) = await SeedMixedScenario();
        var controller = new ReportsController(db);

        var result = await controller.BalanceSheet(companyId, new DateOnly(2026, 12, 31));

        var body = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<BalanceSheetResponse>(body.Value);

        Assert.Equal(600m, response.CurrentEarnings);
        Assert.Equal(2252m, response.TotalAssets);
        Assert.Equal(652m, response.TotalLiabilities);
        Assert.Equal(1600m, response.TotalEquity);

        Assert.Equal(response.TotalAssets, response.TotalLiabilities + response.TotalEquity);

        Assert.Contains(response.Equity, l => l.AccountName == "Current Earnings" && l.Amount == 600m);
    }

    [Fact]
    public async Task VatReturn_SeparatesOutputAndInputAndComputesNetDue()
    {
        var (db, companyId) = await SeedMixedScenario();
        var controller = new ReportsController(db);

        var result = await controller.VatReturn(companyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

        var body = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<VatReturnResponse>(body.Value);

        var output = Assert.Single(response.OutputVat);
        Assert.Equal("VAT 18% (Sales)", output.Name);
        Assert.Equal(0.18m, output.Rate);
        Assert.Equal(180m, output.Amount);

        var input = Assert.Single(response.InputVat);
        Assert.Equal("VAT 18% (Purchases)", input.Name);
        Assert.Equal(72m, input.Amount);

        Assert.Equal(180m, response.TotalOutputVat);
        Assert.Equal(72m, response.TotalInputVat);
        Assert.Equal(108m, response.NetVatDue);
    }
}
