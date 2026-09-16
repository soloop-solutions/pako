using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection —
// without it, connections pile up across the run and Postgres refuses new ones past max_connections.
public class ReportsControllerTests : IAsyncLifetime
{
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

    private async Task<(PakoDbContext Db, Guid CompanyId)> SeedMixedScenario()
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

        // DefaultTaxDefinitionsTemplate's repartition lines target 210100/113100 (Plani
        // Kontabel v2.0's VAT control accounts, COA_V2_IMPLEMENTATION_BRIEF.md Stage 2) — not
        // in the old 16-account DefaultChartOfAccountsTemplate this test otherwise seeds from,
        // so they're added directly.
        accountIdsByCode["210100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = accountIdsByCode["210100"], CompanyId = company.Id, Code = "210100", Name = "Output VAT - Control", AccountType = AccountType.CurrentLiability });
        accountIdsByCode["113100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = accountIdsByCode["113100"], CompanyId = company.Id, Code = "113100", Name = "Input VAT - Control", AccountType = AccountType.CurrentAsset });

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

    // C6: an invoice issued on 30-day terms with 5 days' grace — current up to the due date,
    // within grace until the due date plus 5, and only "debt" (the Overdue bucket) from day 36.
    private async Task<(PakoDbContext Db, Guid CompanyId, Guid InvoiceId, Guid ReceivableJournalEntryLineId)> SeedUnpaidInvoiceWithTerms(
        DateOnly issueDate, int paymentTermDays, int graceDays)
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Debt Co" };
        var receivableAccountId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Customer Co", IsCustomer = true };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };

        db.Companies.Add(company);
        db.Partners.Add(customer);
        db.Journals.Add(journal);
        db.Accounts.Add(new Account { Id = receivableAccountId, CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable });
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

        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = customer.Id,
            IssueDate = issueDate,
            DueDate = issueDate.AddDays(paymentTermDays),
            PaymentTermDays = paymentTermDays,
            GraceDays = graceDays,
            Lines = { new InvoiceLine { Id = Guid.NewGuid(), Description = "Consulting", Quantity = 1m, UnitPrice = 500m, RevenueAccountId = revenueAccountId } }
        };
        var invoiceEntry = invoice.Post(
            company, journal.Id, receivableAccountId, new TaxComputationService(),
            new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        db.Invoices.Add(invoice);
        db.JournalEntries.Add(invoiceEntry);

        await db.SaveChangesAsync();

        var receivableLineId = invoiceEntry.Lines.Single(l => l.AccountId == receivableAccountId).Id;
        return (db, company.Id, invoice.Id, receivableLineId);
    }

    [Fact]
    public async Task DebtAging_BeforeDueDate_IsCurrentNotDebt()
    {
        var issueDate = new DateOnly(2026, 1, 1);
        var (db, companyId, invoiceId, _) = await SeedUnpaidInvoiceWithTerms(issueDate, paymentTermDays: 30, graceDays: 5);
        var controller = new ReportsController(db);

        // Due date is 2026-01-31; asOf here is the due date itself, still Current.
        var result = await controller.DebtAging(companyId, new DateOnly(2026, 1, 31));

        var response = Assert.IsType<DebtAgingResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var line = Assert.Single(response.Lines);
        Assert.Equal(invoiceId, line.InvoiceId);
        Assert.Equal("Current", line.Bucket);
        Assert.Equal(500m, line.Outstanding);
        Assert.Equal(500m, response.TotalCurrent);
        Assert.Equal(0m, response.TotalOverdue);
    }

    [Fact]
    public async Task DebtAging_PastDueButWithinGrace_IsNotYetDebt()
    {
        var issueDate = new DateOnly(2026, 1, 1);
        var (db, companyId, _, _) = await SeedUnpaidInvoiceWithTerms(issueDate, paymentTermDays: 30, graceDays: 5);
        var controller = new ReportsController(db);

        // Day 34 (2026-02-04): 4 days past the 2026-01-31 due date, still inside the 5-day grace.
        var result = await controller.DebtAging(companyId, new DateOnly(2026, 2, 4));

        var response = Assert.IsType<DebtAgingResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var line = Assert.Single(response.Lines);
        Assert.Equal("WithinGrace", line.Bucket);
        Assert.Equal(500m, response.TotalWithinGrace);
        Assert.Equal(0m, response.TotalOverdue);
    }

    [Fact]
    public async Task DebtAging_Day36_BecomesOverdueDebt()
    {
        var issueDate = new DateOnly(2026, 1, 1);
        var (db, companyId, _, _) = await SeedUnpaidInvoiceWithTerms(issueDate, paymentTermDays: 30, graceDays: 5);
        var controller = new ReportsController(db);

        // Day 36 (2026-02-06): due date + grace (2026-02-05) has passed — now real debt.
        var result = await controller.DebtAging(companyId, new DateOnly(2026, 2, 6));

        var response = Assert.IsType<DebtAgingResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var line = Assert.Single(response.Lines);
        Assert.Equal("Overdue", line.Bucket);
        Assert.Equal(500m, response.TotalOverdue);
        Assert.Equal(0m, response.TotalCurrent);
        Assert.Equal(0m, response.TotalWithinGrace);
    }

    [Fact]
    public async Task DebtAging_FullyPaidInvoice_ExcludedEntirely()
    {
        var issueDate = new DateOnly(2026, 1, 1);
        var (db, companyId, invoiceId, receivableJournalEntryLineId) = await SeedUnpaidInvoiceWithTerms(issueDate, paymentTermDays: 30, graceDays: 5);
        db.Reconciliations.Add(Reconciliation.ForInvoice(companyId, invoiceId, receivableJournalEntryLineId, 500m));
        await db.SaveChangesAsync();
        var controller = new ReportsController(db);

        var result = await controller.DebtAging(companyId, new DateOnly(2026, 2, 6));

        var response = Assert.IsType<DebtAgingResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(response.Lines);
        Assert.Equal(0m, response.TotalOverdue);
    }

    // B8: a partner posted against its own ReceivableAccountId override (not the company default)
    // must still show up here — ReportsController.DebtAging used to key entirely off the one
    // company-wide receivable account, which silently dropped every such invoice.
    [Fact]
    public async Task DebtAging_PartnerWithReceivableOverride_StillIncludesInvoice()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Debt Co" };
        var receivableAccountId = Guid.NewGuid();
        var overrideAccountId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Related Party Co", IsCustomer = true, ReceivableAccountId = overrideAccountId };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };

        db.Companies.Add(company);
        db.Partners.Add(customer);
        db.Journals.Add(journal);
        db.Accounts.Add(new Account { Id = receivableAccountId, CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = overrideAccountId, CompanyId = company.Id, Code = "1201", Name = "Receivables - Related Parties", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable });
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

        var issueDate = new DateOnly(2026, 1, 1);
        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = customer.Id,
            IssueDate = issueDate,
            DueDate = issueDate.AddDays(30),
            PaymentTermDays = 30,
            Lines = { new InvoiceLine { Id = Guid.NewGuid(), Description = "Consulting", Quantity = 1m, UnitPrice = 500m, RevenueAccountId = revenueAccountId } }
        };
        var invoiceEntry = invoice.Post(
            company, journal.Id, overrideAccountId, new TaxComputationService(),
            new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        db.Invoices.Add(invoice);
        db.JournalEntries.Add(invoiceEntry);
        await db.SaveChangesAsync();

        var controller = new ReportsController(db);

        var result = await controller.DebtAging(company.Id, new DateOnly(2026, 1, 31));

        var response = Assert.IsType<DebtAgingResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var line = Assert.Single(response.Lines);
        Assert.Equal(invoice.Id, line.InvoiceId);
        Assert.Equal(500m, line.Outstanding);
    }

    // B10: full-stack scenario against the real v2 seed (CompaniesController.Create), so the
    // sales/purchase book queries run against the actual seeded S18/B18 TaxDefinitions and their
    // real AtkBook/RepartitionLines — not a hand-built fixture that might not match what
    // production actually seeds.
    private static ClaimsPrincipal TestUser() =>
        new(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));

    private async Task<(PakoDbContext Db, Guid CompanyId, string InvoiceNumber, string VendorReference)> SeedBookScenarioAsync()
    {
        var db = await NewContextAsync();

        var companiesController = new CompaniesController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = TestUser() } }
        };
        var companyResult = await companiesController.Create(new CreateCompanyRequest("Book Co"));
        var company = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(companyResult.Result).Value);

        var partnersController = new PartnersController(db, new NullStringLocalizer<ErrorMessages>());
        // IsVatRegistered: true — R07 (PostingRuleValidator.ValidateVatCounterpartyTaxNumber, B8)
        // requires TaxNumber specifically for a VAT-registered counterparty; a business posting
        // real VAT codes (S18/B18) needs this set, not FiscalNumber (the natural-person case).
        var customerResult = await partnersController.Create(company.Id, new CreatePartnerRequest("Customer Co", "810111111", IsCustomer: true, IsVendor: false, IsVatRegistered: true));
        var customer = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(customerResult.Result).Value);
        var vendorResult = await partnersController.Create(company.Id, new CreatePartnerRequest("Vendor Co", "810222222", IsCustomer: false, IsVendor: true, IsVatRegistered: true));
        var vendor = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(vendorResult.Result).Value);

        var s18 = await db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == company.Id && t.Code == "S18");
        var b18 = await db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == company.Id && t.Code == "B18");
        var defaults = await db.CompanyAccountDefaults.AsNoTracking().SingleAsync(d => d.CompanyId == company.Id);

        var invoicesController = new InvoicesController(db, new TaxComputationService(), new DocumentNumberService(), new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = TestUser() } }
        };
        var invoiceCreateResult = await invoicesController.Create(company.Id, new CreateInvoiceRequest(
            customer.Id, new DateOnly(2026, 2, 1), new DateOnly(2026, 3, 1),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 1000m, s18.Id, defaults.RevenueAccountId) }));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceCreateResult.Result).Value);
        var invoicePostResult = await invoicesController.Post(company.Id, invoice.Id);
        Assert.IsType<OkObjectResult>(invoicePostResult.Result);
        var postedInvoice = await db.Invoices.AsNoTracking().SingleAsync(i => i.Id == invoice.Id);
        Assert.Equal(InvoiceState.Posted, postedInvoice.State);

        var billsController = new BillsController(db, new TaxComputationService(), new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = TestUser() } }
        };
        var billCreateResult = await billsController.Create(company.Id, new CreateBillRequest(
            vendor.Id, "SUPPLIER-1", new DateOnly(2026, 3, 1), new DateOnly(2026, 3, 31),
            new List<CreateBillLineRequest> { new("Office rent", 1m, 400m, b18.Id, defaults.ExpenseAccountId) }));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(billCreateResult.Result).Value);
        await billsController.Post(company.Id, bill.Id);

        return (db, company.Id, postedInvoice.InvoiceNumber!, "SUPPLIER-1");
    }

    [Fact]
    public async Task SalesBook_IncludesPostedInvoiceWithVatCode()
    {
        var (db, companyId, invoiceNumber, _) = await SeedBookScenarioAsync();
        var controller = new ReportsController(db);

        var result = await controller.SalesBook(companyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

        var response = Assert.IsType<SalesBookResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var line = Assert.Single(response.Lines);
        Assert.Equal(invoiceNumber, line.InvoiceNumber);
        Assert.Equal("S18", line.VatCode);
        Assert.Equal("Customer Co", line.PartnerName);
        Assert.Equal("810111111", line.PartnerTaxNumber);
        Assert.Equal(847.46m, line.NetAmount);
        Assert.Equal(152.54m, line.VatAmount);
        Assert.Equal(1000m, line.GrossAmount);
        Assert.Equal(847.46m, response.TotalNet);
        Assert.Equal(152.54m, response.TotalVat);
        Assert.Equal(1000m, response.TotalGross);
    }

    [Fact]
    public async Task PurchaseBook_IncludesPostedBillWithVatCode()
    {
        var (db, companyId, _, vendorReference) = await SeedBookScenarioAsync();
        var controller = new ReportsController(db);

        var result = await controller.PurchaseBook(companyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

        var response = Assert.IsType<PurchaseBookResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var line = Assert.Single(response.Lines);
        Assert.Equal(vendorReference, line.VendorReference);
        Assert.Equal("B18", line.VatCode);
        Assert.Equal("Vendor Co", line.PartnerName);
        Assert.Equal("810222222", line.PartnerTaxNumber);
        Assert.Equal(338.98m, line.NetAmount);
        Assert.Equal(61.02m, line.VatAmount);
        Assert.Equal(400m, line.GrossAmount);
    }

    // B11: the export wrapper is a thin pass-through over the JSON action's own data — this proves
    // the file it hands back is actually a valid, readable workbook containing that same row.
    [Fact]
    public async Task SalesBookExport_ReturnsXlsxWithMatchingRow()
    {
        var (db, companyId, invoiceNumber, _) = await SeedBookScenarioAsync();
        var controller = new ReportsController(db);

        var result = await controller.SalesBookExport(companyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

        var fileResult = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileResult.ContentType);
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(fileResult.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Invoice Number", sheet.Cell(1, 1).GetString());
        Assert.Equal(invoiceNumber, sheet.Cell(2, 1).GetString());
        Assert.Equal("S18", sheet.Cell(2, 7).GetString());
    }

    [Fact]
    public async Task PurchaseBookExport_ReturnsXlsxWithMatchingRow()
    {
        var (db, companyId, _, vendorReference) = await SeedBookScenarioAsync();
        var controller = new ReportsController(db);

        var result = await controller.PurchaseBookExport(companyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

        var fileResult = Assert.IsType<FileContentResult>(result);
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(fileResult.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Vendor Reference", sheet.Cell(1, 1).GetString());
        Assert.Equal(vendorReference, sheet.Cell(2, 1).GetString());
        Assert.Equal("B18", sheet.Cell(2, 7).GetString());
    }

    // B10: a document outside the from/to range must not appear, even though it's Posted.
    [Fact]
    public async Task SalesBook_ExcludesInvoiceOutsideDateRange()
    {
        var (db, companyId, _, _) = await SeedBookScenarioAsync();
        var controller = new ReportsController(db);

        var result = await controller.SalesBook(companyId, new DateOnly(2026, 4, 1), new DateOnly(2026, 12, 31));

        var response = Assert.IsType<SalesBookResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(response.Lines);
    }
}
