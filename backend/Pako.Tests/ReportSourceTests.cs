using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using BillDocumentType = Pako.Domain.Bills.DocumentType;
using InvoiceDocumentType = Pako.Domain.Invoicing.DocumentType;

namespace Pako.Tests;

public class ReportSourceTests : IAsyncLifetime
{
    private static readonly DateOnly Jan1 = new(2026, 1, 1);
    private static readonly DateOnly Jan31 = new(2026, 1, 31);
    private static readonly DateOnly Jan15 = new(2026, 1, 15);

    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private class Env
    {
        public required PakoDbContext Db { get; init; }
        public required Company Company { get; init; }
        public required Account Payable { get; init; }
        public required Account Expense { get; init; }
        public required Account Cash { get; init; }
        public required Journal Purchases { get; init; }
        public required Journal General { get; init; }
        public required Partner Vendor { get; init; }
    }

    private async Task<Env> NewEnvAsync(string name = "Test Co")
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        return await AddCompanyAsync(db, name);
    }

    private static async Task<Env> AddCompanyAsync(PakoDbContext db, string name)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = name };
        Account Acc(string code, string n, AccountType type) =>
            new() { Id = Guid.NewGuid(), CompanyId = company.Id, Code = code, Name = n, AccountType = type };
        var cash = Acc("1000", "Bank", AccountType.Cash);
        var payable = Acc("2000", "Accounts Payable", AccountType.Payable);
        var expense = Acc("6000", "Expense", AccountType.Expense);
        db.Companies.Add(company);
        db.Accounts.AddRange(cash, payable, expense);
        var purchases = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Purchase, Code = "PUR", Name = "Purchases" };
        var general = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Journals.AddRange(purchases, general);
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Vendor " + name, IsVendor = true };
        db.Partners.Add(vendor);
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, ReceivableAccountId = Guid.NewGuid(), PayableAccountId = payable.Id,
            RevenueAccountId = Guid.NewGuid(), ExpenseAccountId = expense.Id, CustomerDepositsAccountId = Guid.NewGuid()
        });
        await db.SaveChangesAsync();
        return new Env { Db = db, Company = company, Payable = payable, Expense = expense, Cash = cash, Purchases = purchases, General = general, Vendor = vendor };
    }

    private static JournalEntry Entry(Env e, string reference, Guid? sourceDocumentId, Journal? journal = null, decimal amount = 100m, DateOnly? date = null)
    {
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = e.Company.Id, JournalId = (journal ?? e.General).Id, Date = date ?? Jan15,
            Reference = reference, SourceDocumentId = sourceDocumentId
        };
        entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = e.Expense.Id, Debit = amount, Credit = 0m });
        entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = e.Payable.Id, Debit = 0m, Credit = amount, PartnerId = e.Vendor.Id });
        entry.Post(e.Company);
        e.Db.JournalEntries.Add(entry);
        return entry;
    }

    private static Invoice AddInvoice(Env e, InvoiceDocumentType type)
    {
        var invoice = new Invoice
        {
            Id = Guid.NewGuid(), CompanyId = e.Company.Id, PartnerId = e.Vendor.Id, IssueDate = Jan15, DueDate = Jan31, DocumentType = type
        };
        e.Db.Invoices.Add(invoice);
        return invoice;
    }

    private static Bill AddBill(Env e, BillDocumentType type, string reference, decimal amount)
    {
        var bill = new Bill
        {
            Id = Guid.NewGuid(), CompanyId = e.Company.Id, PartnerId = e.Vendor.Id, VendorReference = reference,
            IssueDate = Jan15, DueDate = Jan31, DocumentType = type,
            Lines = { new BillLine { Id = Guid.NewGuid(), Description = "Goods", Quantity = 1m, UnitPrice = amount, ExpenseAccountId = e.Expense.Id } }
        };
        var entry = bill.Post(
            e.Company, e.Purchases.Id, e.Payable.Id, new TaxComputationService(),
            new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        entry.SourceDocumentId = bill.Id;
        e.Db.Bills.Add(bill);
        e.Db.JournalEntries.Add(entry);
        return bill;
    }

    [Fact]
    public async Task Resolver_ClassifiesEveryKind_ByTheSameRuleAsSearch()
    {
        var e = await NewEnvAsync();
        var invoice = AddInvoice(e, InvoiceDocumentType.Invoice);
        var salesReturn = AddInvoice(e, InvoiceDocumentType.SalesReturn);
        var bill = new Bill { Id = Guid.NewGuid(), CompanyId = e.Company.Id, PartnerId = e.Vendor.Id, VendorReference = "B", IssueDate = Jan15, DueDate = Jan31, DocumentType = BillDocumentType.Bill };
        var purchaseReturn = new Bill { Id = Guid.NewGuid(), CompanyId = e.Company.Id, PartnerId = e.Vendor.Id, VendorReference = "R", IssueDate = Jan15, DueDate = Jan31, DocumentType = BillDocumentType.PurchaseReturn };
        var payroll = new PayrollRun { Id = Guid.NewGuid(), CompanyId = e.Company.Id, PeriodStart = Jan1, PeriodEnd = Jan31 };
        var warehouse = new Warehouse { Id = Guid.NewGuid(), CompanyId = e.Company.Id, Code = "W1", Name = "Main" };
        var stock = new StockDocument { Id = Guid.NewGuid(), CompanyId = e.Company.Id, WarehouseId = warehouse.Id, Date = Jan15 };
        e.Db.AddRange(bill, purchaseReturn, payroll, warehouse);
        await e.Db.SaveChangesAsync();
        e.Db.StockDocuments.Add(stock);

        var eInvoice = Entry(e, "I", invoice.Id);
        var eReturn = Entry(e, "SR", salesReturn.Id);
        var eBill = Entry(e, "B", bill.Id);
        var ePurchaseReturn = Entry(e, "PR", purchaseReturn.Id);
        var ePayroll = Entry(e, "P", payroll.Id);
        var eStock = Entry(e, "S", stock.Id);
        var eManual = Entry(e, "M", null);
        var eOrphan = Entry(e, "O", Guid.NewGuid());
        await e.Db.SaveChangesAsync();

        var result = await new ReportSourceResolver(e.Db).ResolveEntriesAsync(
            e.Company.Id, new[] { eInvoice, eReturn, eBill, ePurchaseReturn, ePayroll, eStock, eManual, eOrphan }.Select(x => x.Id));

        Assert.Equal(new ReportSource(ReportSourceKinds.Invoice, invoice.Id), result[eInvoice.Id]);
        Assert.Equal(new ReportSource(ReportSourceKinds.SalesReturn, salesReturn.Id), result[eReturn.Id]);
        Assert.Equal(new ReportSource(ReportSourceKinds.Bill, bill.Id), result[eBill.Id]);
        Assert.Equal(new ReportSource(ReportSourceKinds.PurchaseReturn, purchaseReturn.Id), result[ePurchaseReturn.Id]);
        Assert.Equal(new ReportSource(ReportSourceKinds.PayrollRun, payroll.Id), result[ePayroll.Id]);
        Assert.Equal(new ReportSource(ReportSourceKinds.StockDocument, stock.Id), result[eStock.Id]);
        Assert.Equal(new ReportSource(ReportSourceKinds.JournalEntry, eManual.Id), result[eManual.Id]);
        Assert.Equal(new ReportSource(ReportSourceKinds.JournalEntry, eOrphan.Id), result[eOrphan.Id]);
    }

    [Fact]
    public async Task Resolver_NeverResolvesAnotherCompanysEntry_OrDocument()
    {
        var mine = await NewEnvAsync("Mine");
        var theirs = await AddCompanyAsync(mine.Db, "Theirs");
        var theirInvoice = AddInvoice(theirs, InvoiceDocumentType.Invoice);
        var theirEntry = Entry(theirs, "X", theirInvoice.Id);
        var myEntry = Entry(mine, "Y", theirInvoice.Id);
        await mine.Db.SaveChangesAsync();

        var result = await new ReportSourceResolver(mine.Db).ResolveEntriesAsync(mine.Company.Id, new[] { theirEntry.Id, myEntry.Id });

        Assert.False(result.ContainsKey(theirEntry.Id));
        Assert.Equal(new ReportSource(ReportSourceKinds.JournalEntry, myEntry.Id), result[myEntry.Id]);
    }

    private sealed class CommandCounter : DbCommandInterceptor
    {
        public int Count;
        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Count++;
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Count++;
            return new ValueTask<InterceptionResult<DbDataReader>>(result);
        }
    }

    [Fact]
    public async Task Resolver_QueryCountIsConstant_For5And50Entries_NoNPlusOne()
    {
        var e = await NewEnvAsync();
        var entryIds = new List<Guid>();
        for (var i = 0; i < 50; i++)
        {
            var invoice = AddInvoice(e, InvoiceDocumentType.Invoice);
            entryIds.Add(Entry(e, $"E{i}", invoice.Id).Id);
        }

        await e.Db.SaveChangesAsync();

        var counter = new CommandCounter();
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseNpgsql(e.Db.Database.GetConnectionString()!).AddInterceptors(counter).Options;
        await using var counted = new PakoDbContext(options);
        var resolver = new ReportSourceResolver(counted);

        await resolver.ResolveEntriesAsync(e.Company.Id, entryIds.Take(5));
        var five = counter.Count;
        counter.Count = 0;
        await resolver.ResolveEntriesAsync(e.Company.Id, entryIds);
        var fifty = counter.Count;

        Assert.True(five > 0);
        Assert.Equal(five, fifty);
        Assert.True(fifty <= 5);
    }

    private record Mixed(Env E, Invoice Invoice, Bill Bill, JournalEntry InvoiceEntry, JournalEntry ManualEntry);

    private async Task<Mixed> SeedMixedAsync()
    {
        var e = await NewEnvAsync();
        var invoice = AddInvoice(e, InvoiceDocumentType.Invoice);
        var invoiceEntry = Entry(e, "INV-1", invoice.Id, amount: 250m);
        var bill = AddBill(e, BillDocumentType.Bill, "BILL-1", 400m);
        var manual = Entry(e, "MAN-1", null, amount: 75m);
        await e.Db.SaveChangesAsync();
        return new Mixed(e, invoice, bill, invoiceEntry, manual);
    }

    private static T Ok<T>(ActionResult<T> result) => Assert.IsType<T>(Assert.IsType<OkObjectResult>(result.Result).Value);

    [Fact]
    public async Task GeneralLedger_CarriesAccountIdAndSourceKindAndId()
    {
        var m = await SeedMixedAsync();
        var access = CompanyAccessContext.Unrestricted();
        var controller = new GeneralLedgerReportController(m.E.Db, new NullStringLocalizer<ErrorMessages>(), access, new ExportLabels(new NullStringLocalizer<ErrorMessages>()));

        var response = Ok(await controller.GeneralLedger(m.E.Company.Id, Jan1, Jan31, null, null));

        Assert.All(response.Items, l => Assert.NotEqual(Guid.Empty, l.AccountId));
        var invoiceLines = response.Items.Where(l => l.EntryId == m.InvoiceEntry.Id).ToList();
        Assert.All(invoiceLines, l => { Assert.Equal(ReportSourceKinds.Invoice, l.SourceKind); Assert.Equal(m.Invoice.Id, l.SourceId); });
        Assert.Contains(invoiceLines, l => l.AccountId == m.E.Expense.Id);
        Assert.Contains(invoiceLines, l => l.AccountId == m.E.Payable.Id && l.PartnerId == m.E.Vendor.Id);
        var billLines = response.Items.Where(l => l.SourceId == m.Bill.Id).ToList();
        Assert.NotEmpty(billLines);
        Assert.All(billLines, l => Assert.Equal(ReportSourceKinds.Bill, l.SourceKind));
        var manual = response.Items.Where(l => l.EntryId == m.ManualEntry.Id).ToList();
        Assert.All(manual, l => { Assert.Equal(ReportSourceKinds.JournalEntry, l.SourceKind); Assert.Equal(m.ManualEntry.Id, l.SourceId); });
    }

    [Fact]
    public async Task ExpenseBook_CarriesSourceKindAndId_AndPartner()
    {
        var m = await SeedMixedAsync();
        var controller = new ExpenseBookController(m.E.Db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));

        var response = Ok(await controller.ExpenseBook(m.E.Company.Id, Jan1, Jan31));

        var invoiceRow = response.Rows.Single(r => r.EntryId == m.InvoiceEntry.Id);
        Assert.Equal(ReportSourceKinds.Invoice, invoiceRow.SourceKind);
        Assert.Equal(m.Invoice.Id, invoiceRow.SourceId);
        Assert.Equal(m.E.Vendor.Id, invoiceRow.PartnerId);
        var billRow = response.Rows.Single(r => r.SourceId == m.Bill.Id);
        Assert.Equal(ReportSourceKinds.Bill, billRow.SourceKind);
        var manualRow = response.Rows.Single(r => r.EntryId == m.ManualEntry.Id);
        Assert.Equal(ReportSourceKinds.JournalEntry, manualRow.SourceKind);
        Assert.Equal(m.ManualEntry.Id, manualRow.SourceId);
    }

    private static PayablesReportsController Payables(PakoDbContext db) =>
        new(new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(),
            new VendorLedgerService(db, CompanyAccessContext.Unrestricted()), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));

    [Fact]
    public async Task VendorStatement_RowsCarryEntryIdAndSource()
    {
        var m = await SeedMixedAsync();

        var response = Ok(await Payables(m.E.Db).VendorStatement(m.E.Company.Id, m.E.Vendor.Id, Jan1, Jan31));

        Assert.Equal(3, response.Rows.Count);
        var invoiceRow = response.Rows.Single(r => r.EntryId == m.InvoiceEntry.Id);
        Assert.Equal(ReportSourceKinds.Invoice, invoiceRow.SourceKind);
        Assert.Equal(m.Invoice.Id, invoiceRow.SourceId);
        var billRow = response.Rows.Single(r => r.SourceId == m.Bill.Id);
        Assert.Equal(ReportSourceKinds.Bill, billRow.SourceKind);
        Assert.NotNull(billRow.EntryId);
        var manualRow = response.Rows.Single(r => r.EntryId == m.ManualEntry.Id);
        Assert.Equal(ReportSourceKinds.JournalEntry, manualRow.SourceKind);
        Assert.Equal(m.ManualEntry.Id, manualRow.SourceId);
    }

    [Fact]
    public async Task PurchaseTransactions_CarryDocumentPartnerItemAndKind()
    {
        var m = await SeedMixedAsync();
        var purchaseReturn = AddBill(m.E, BillDocumentType.PurchaseReturn, "PRET-1", 50m);
        await m.E.Db.SaveChangesAsync();

        var response = Ok(await Payables(m.E.Db).PurchaseTransactions(m.E.Company.Id, Jan1, Jan31, null));

        var billLine = response.Items.Single(i => i.DocumentId == m.Bill.Id);
        Assert.Equal(ReportSourceKinds.Bill, billLine.SourceKind);
        Assert.Equal(m.Bill.Id, billLine.SourceId);
        Assert.Equal(m.E.Vendor.Id, billLine.PartnerId);
        Assert.Null(billLine.ItemId);
        var returnLine = response.Items.Single(i => i.DocumentId == purchaseReturn.Id);
        Assert.Equal(ReportSourceKinds.PurchaseReturn, returnLine.SourceKind);
    }

    [Fact]
    public async Task PayablesAging_LinesCarryBillKindAndId()
    {
        var m = await SeedMixedAsync();

        var response = Ok(await Payables(m.E.Db).PayablesAging(m.E.Company.Id, Jan31));

        var line = Assert.Single(response.Lines);
        Assert.Equal(m.Bill.Id, line.BillId);
        Assert.Equal(ReportSourceKinds.Bill, line.SourceKind);
        Assert.Equal(m.Bill.Id, line.SourceId);
        Assert.Equal(m.E.Vendor.Id, line.PartnerId);
    }

    [Fact]
    public void SourceKinds_FollowSearchControllersRule()
    {
        Assert.Equal(ReportSourceKinds.SalesReturn, ReportSourceKinds.ForInvoice(InvoiceDocumentType.SalesReturn));
        Assert.Equal(ReportSourceKinds.Invoice, ReportSourceKinds.ForInvoice(InvoiceDocumentType.CreditNote));
        Assert.Equal(ReportSourceKinds.Invoice, ReportSourceKinds.ForInvoice(InvoiceDocumentType.DebitNote));
        Assert.Equal(ReportSourceKinds.PurchaseReturn, ReportSourceKinds.ForBill(BillDocumentType.PurchaseReturn));
        Assert.Equal(ReportSourceKinds.Bill, ReportSourceKinds.ForBill(BillDocumentType.CreditNote));
        Assert.Equal(ReportSourceKinds.SalesReturn, ReportSourceKinds.ForInvoice("SalesReturn"));
        Assert.Equal(ReportSourceKinds.PurchaseReturn, ReportSourceKinds.ForBill("PurchaseReturn"));
    }
}
