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

        // DefaultTaxDefinitionsTemplate's repartition lines target 210100/113100 (Plani
        // Kontabel v2.0's VAT control accounts, COA_V2_IMPLEMENTATION_BRIEF.md Stage 2) — not
        // in the old 16-account DefaultChartOfAccountsTemplate this test otherwise seeds from,
        // so they're added directly.
        accountIdsByCode["210100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = accountIdsByCode["210100"], CompanyId = company.Id, Code = "210100", Name = "Output VAT - Control", AccountType = AccountType.Liability });
        accountIdsByCode["113100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = accountIdsByCode["113100"], CompanyId = company.Id, Code = "113100", Name = "Input VAT - Control", AccountType = AccountType.Asset });

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
            company, journal.Id, accountIdsByCode["1200"], taxComputationService, taxDefinitionsById, Guid.NewGuid(), Guid.NewGuid());
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
            company, journal.Id, accountIdsByCode["2000"], taxComputationService, taxDefinitionsById, Guid.NewGuid(), Guid.NewGuid());
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

        // Line entry is gross: the invoice's 1000/bill's 400 are VAT-inclusive totals, not net
        // amounts — 1000/1.18 = 847.4576... rounds to 847.46 (tax 152.54, the exact remainder);
        // 400/1.18 = 338.9830... rounds to 338.98 (tax 61.02).
        var revenue = Assert.Single(response.Income);
        Assert.Equal("4000", revenue.AccountCode);
        Assert.Equal(847.46m, revenue.Amount);

        var expense = Assert.Single(response.Expenses);
        Assert.Equal("6000", expense.AccountCode);
        Assert.Equal(338.98m, expense.Amount);

        Assert.Equal(847.46m, response.TotalIncome);
        Assert.Equal(338.98m, response.TotalExpenses);
        Assert.Equal(508.48m, response.NetIncome);
    }

    [Fact]
    public async Task BalanceSheet_AssetsEqualLiabilitiesPlusEquity_ForMixedScenario()
    {
        var (db, companyId) = await SeedMixedScenario();
        var controller = new ReportsController(db);

        var result = await controller.BalanceSheet(companyId, new DateOnly(2026, 12, 31));

        var body = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<BalanceSheetResponse>(body.Value);

        Assert.Equal(508.48m, response.CurrentEarnings);
        Assert.Equal(2061.02m, response.TotalAssets);
        Assert.Equal(552.54m, response.TotalLiabilities);
        Assert.Equal(1508.48m, response.TotalEquity);

        Assert.Equal(response.TotalAssets, response.TotalLiabilities + response.TotalEquity);

        Assert.Contains(response.Equity, l => l.AccountName == "Current Earnings" && l.Amount == 508.48m);
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
        Assert.Equal(152.54m, output.Amount);

        var input = Assert.Single(response.InputVat);
        Assert.Equal("VAT 18% (Purchases)", input.Name);
        Assert.Equal(61.02m, input.Amount);

        Assert.Equal(152.54m, response.TotalOutputVat);
        Assert.Equal(61.02m, response.TotalInputVat);
        Assert.Equal(91.52m, response.NetVatDue);
    }
}
