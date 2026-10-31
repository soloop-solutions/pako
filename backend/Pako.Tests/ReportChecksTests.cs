using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Tests;

public class ReportChecksTests : IAsyncLifetime
{
    private static readonly DateOnly Jan1 = new(2026, 1, 1);
    private static readonly DateOnly Dec31 = new(2026, 12, 31);

    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private async Task<PakoDbContext> NewContextAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        return db;
    }

    private static ReportChecksController Controller(PakoDbContext db, CompanyAccessContext? access = null) =>
        new(new NullStringLocalizer<ErrorMessages>(), access ?? CompanyAccessContext.Unrestricted(),
            new LedgerAggregator(db), new TaxReportService(db, access ?? CompanyAccessContext.Unrestricted()),
            new VendorLedgerService(db, access ?? CompanyAccessContext.Unrestricted()));

    private async Task<(PakoDbContext Db, Guid CompanyId, Dictionary<string, Guid> Accounts, Guid JournalId)> SeedMixedScenario()
    {
        var db = await NewContextAsync();
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

        accountIdsByCode["210100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = accountIdsByCode["210100"], CompanyId = company.Id, Code = "210100", Name = "Output VAT - Control", AccountType = AccountType.CurrentLiability });
        accountIdsByCode["113100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = accountIdsByCode["113100"], CompanyId = company.Id, Code = "113100", Name = "Input VAT - Control", AccountType = AccountType.CurrentAsset });

        foreach (var acc in db.Accounts.Local.Where(a => a.CompanyId == company.Id))
        {
            acc.CashFlowCategory = acc.Code switch
            {
                "1200" or "2000" or "210100" or "113100" => CashFlowCategory.Operating,
                "3000" => CashFlowCategory.Financing,
                _ => acc.CashFlowCategory
            };
        }

        var taxDefinitions = DefaultTaxDefinitionsTemplate.CreateDefaultTaxDefinitions(company.Id, accountIdsByCode);
        db.TaxDefinitions.AddRange(taxDefinitions);
        var taxDefinitionsById = taxDefinitions.ToDictionary(t => t.Id);
        var vatOnSales = taxDefinitions.Single(t => t.Name == "VAT 18% (Sales)");
        var vatOnPurchases = taxDefinitions.Single(t => t.Name == "VAT 18% (Purchases)");

        vatOnSales.AtkBook = TaxAtkBook.Shitje;
        vatOnPurchases.AtkBook = TaxAtkBook.Blerje;

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

        return (db, company.Id, accountIdsByCode, journal.Id);
    }

    private static async Task<ReportChecksResponse> Run(ReportChecksController controller, Guid companyId, DateOnly from, DateOnly to) =>
        Assert.IsType<ReportChecksResponse>(Assert.IsType<OkObjectResult>((await controller.Checks(companyId, from, to)).Result).Value);

    [Fact]
    public async Task Checks_BalancedScenario_AllSixChecksPass()
    {
        var (db, companyId, _, _) = await SeedMixedScenario();

        var response = await Run(Controller(db), companyId, Jan1, Dec31);

        Assert.Equal(
            new[] { "balance-sheet-balances", "net-profit-consistent", "cash-flow-closes", "trial-balance-balances", "books-match-vat-return", "vendor-total-matches-payables" },
            response.Checks.Select(c => c.Key));
        Assert.All(response.Checks, c => Assert.True(c.Passed, c.Key));

        var byKey = response.Checks.ToDictionary(c => c.Key);
        Assert.Equal(2061.02m, byKey["balance-sheet-balances"].Expected);
        Assert.Equal(2061.02m, byKey["balance-sheet-balances"].Actual);
        Assert.Equal(508.48m, byKey["net-profit-consistent"].Expected);
        Assert.Equal(508.48m, byKey["net-profit-consistent"].Actual);
        Assert.Equal(1000m, byKey["cash-flow-closes"].Expected);
        Assert.Equal(1000m, byKey["cash-flow-closes"].Actual);
        Assert.Equal(2400m, byKey["trial-balance-balances"].Expected);
        Assert.Equal(2400m, byKey["trial-balance-balances"].Actual);
        Assert.Equal(91.52m, byKey["books-match-vat-return"].Expected);
        Assert.Equal(91.52m, byKey["books-match-vat-return"].Actual);
        Assert.Equal(400m, byKey["vendor-total-matches-payables"].Expected);
        Assert.Equal(400m, byKey["vendor-total-matches-payables"].Actual);
    }

    [Fact]
    public async Task Checks_VendorTotalMatchesPayables()
    {
        var (db, companyId, _, _) = await SeedMixedScenario();

        var check = (await Run(Controller(db), companyId, Jan1, Dec31)).Checks.Single(c => c.Key == "vendor-total-matches-payables");

        Assert.True(check.Passed);
        Assert.Equal(400m, check.Expected);
        Assert.Equal(400m, check.Actual);
    }

    [Fact]
    public async Task Checks_UnpartneredPayableLine_FailsVendorCheck()
    {
        var (db, companyId, accounts, journalId) = await SeedMixedScenario();
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JournalId = journalId,
            Date = new DateOnly(2026, 4, 1),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accounts["6000"], Debit = 100m, Credit = 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accounts["2000"], Debit = 0m, Credit = 100m }
            }
        };
        entry.State = JournalEntryState.Posted;
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var check = (await Run(Controller(db), companyId, Jan1, Dec31)).Checks.Single(c => c.Key == "vendor-total-matches-payables");

        Assert.False(check.Passed);
        Assert.Equal(500m, check.Expected);
        Assert.Equal(400m, check.Actual);
    }

    [Fact]
    public async Task Checks_BalanceSheetImbalance_IsReported()
    {
        var (db, companyId, accounts, journalId) = await SeedMixedScenario();
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JournalId = journalId,
            Date = new DateOnly(2026, 4, 1),
            Lines = { new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accounts["1000"], Debit = 250m, Credit = 0m } }
        };
        entry.State = JournalEntryState.Posted;
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var response = await Run(Controller(db), companyId, Jan1, Dec31);
        var byKey = response.Checks.ToDictionary(c => c.Key);

        Assert.False(byKey["balance-sheet-balances"].Passed);
        Assert.Equal(2311.02m, byKey["balance-sheet-balances"].Expected);
        Assert.Equal(2061.02m, byKey["balance-sheet-balances"].Actual);
        Assert.False(byKey["trial-balance-balances"].Passed);
        Assert.Equal(2650m, byKey["trial-balance-balances"].Expected);
        Assert.Equal(2400m, byKey["trial-balance-balances"].Actual);
    }

    [Fact]
    public async Task Checks_NetProfitMatchesBalanceSheetCurrentEarnings()
    {
        var (db, companyId, _, _) = await SeedMixedScenario();
        var controller = Controller(db);

        var fullYear = (await Run(controller, companyId, Jan1, Dec31)).Checks.Single(c => c.Key == "net-profit-consistent");
        Assert.True(fullYear.Passed);
        Assert.Equal(508.48m, fullYear.Expected);
        Assert.Equal(508.48m, fullYear.Actual);

        var fromMarch = (await Run(controller, companyId, new DateOnly(2026, 3, 1), Dec31)).Checks.Single(c => c.Key == "net-profit-consistent");
        Assert.True(fromMarch.Passed);
        Assert.Equal(-338.98m, fromMarch.Expected);
        Assert.Equal(-338.98m, fromMarch.Actual);

        var minValue = (await Run(controller, companyId, DateOnly.MinValue, Dec31)).Checks.Single(c => c.Key == "net-profit-consistent");
        Assert.Equal(508.48m, minValue.Actual);
    }

    [Fact]
    public async Task Checks_NetProfitConsistent_FailsWhenLedgerUnbalanced()
    {
        var (db, companyId, accounts, journalId) = await SeedMixedScenario();
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JournalId = journalId,
            Date = new DateOnly(2026, 4, 1),
            Lines = { new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accounts["6000"], Debit = 100m, Credit = 0m } }
        };
        entry.State = JournalEntryState.Posted;
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var check = (await Run(Controller(db), companyId, Jan1, Dec31)).Checks.Single(c => c.Key == "net-profit-consistent");

        Assert.False(check.Passed);
        Assert.Equal(408.48m, check.Expected);
        Assert.Equal(508.48m, check.Actual);
    }

    [Fact]
    public async Task Checks_NetProfitConsistent_FromMinValue_DoesNotThrow()
    {
        var (db, companyId, _, _) = await SeedMixedScenario();

        var check = (await Run(Controller(db), companyId, DateOnly.MinValue, Dec31)).Checks.Single(c => c.Key == "net-profit-consistent");

        Assert.True(check.Passed);
        Assert.Equal(508.48m, check.Expected);
        Assert.Equal(508.48m, check.Actual);
    }

    [Fact]
    public async Task Checks_CashFlowCloses()
    {
        var (db, companyId, _, _) = await SeedMixedScenario();

        var check = (await Run(Controller(db), companyId, Jan1, Dec31)).Checks.Single(c => c.Key == "cash-flow-closes");

        Assert.True(check.Passed);
        Assert.Equal(1000m, check.Expected);
        Assert.Equal(1000m, check.Actual);
    }

    [Fact]
    public async Task Checks_BooksMatchVatReturn()
    {
        var (db, companyId, _, _) = await SeedMixedScenario();

        var check = (await Run(Controller(db), companyId, Jan1, Dec31)).Checks.Single(c => c.Key == "books-match-vat-return");

        Assert.True(check.Passed);
        Assert.Equal(91.52m, check.Expected);
        Assert.Equal(91.52m, check.Actual);
    }

    [Fact]
    public async Task Checks_EmptyCompany_AllPass()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Empty Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var response = await Run(Controller(db), company.Id, Jan1, Dec31);

        Assert.Equal(6, response.Checks.Count);
        Assert.All(response.Checks, c =>
        {
            Assert.True(c.Passed, c.Key);
            Assert.Equal(0m, c.Expected);
            Assert.Equal(0m, c.Actual);
        });
    }

    [Fact]
    public async Task Checks_FromAfterTo_Returns400()
    {
        var (db, companyId, _, _) = await SeedMixedScenario();

        var result = await Controller(db).Checks(companyId, Dec31, Jan1);

        Assert.Equal(400, Assert.IsType<BadRequestObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Checks_PartnerRestricted_Returns403()
    {
        var (db, companyId, _, _) = await SeedMixedScenario();
        var access = CompanyAccessContext.ForStaff(companyId, Guid.NewGuid(), Guid.NewGuid(), new Department(), new HashSet<Guid> { Guid.NewGuid() });

        var result = await Controller(db, access).Checks(companyId, Jan1, Dec31);

        Assert.Equal(403, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }
}
