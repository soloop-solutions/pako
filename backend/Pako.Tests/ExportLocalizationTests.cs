using System.Globalization;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Tests;

public class ExportLocalizationTests : IAsyncLifetime
{
    private static readonly DateOnly From = new(2026, 1, 1);
    private static readonly DateOnly To = new(2026, 1, 31);
    private static readonly string[] Months = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
    private static readonly string[] MonthsSq = { "Jan", "Shk", "Mar", "Pri", "Maj", "Qer", "Kor", "Gus", "Sht", "Tet", "Nën", "Dhj" };

    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid EntryId);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var cash = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.CurrentAsset };
        var revenue = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income };
        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Alpha Supplies", IsVendor = true };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Companies.Add(company);
        db.Accounts.AddRange(cash, revenue);
        db.Partners.Add(partner);
        db.Journals.Add(journal);
        var entry = new JournalEntry { Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = journal.Id, Date = new DateOnly(2026, 1, 10) };
        entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = cash.Id, Debit = 100m, Credit = 0m });
        entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = revenue.Id, Debit = 0m, Credit = 100m });
        entry.Post(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();
        return new Seed(db, company.Id, partner.Id, entry.Id);
    }

    private static ExportLabels Labels() => new(new NullStringLocalizer<ErrorMessages>());

    private static ReportsController Reports(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db), Labels());

    private static StatementReportsController Statements(PakoDbContext db) =>
        new(new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db), Labels());

    private static LedgerController Ledger(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), Labels());

    private static GeneralLedgerReportController GeneralLedger(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), Labels());

    private static ExpenseBookController ExpenseBook(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), Labels());

    private static PayablesReportsController Payables(PakoDbContext db) =>
        new(new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new VendorLedgerService(db, CompanyAccessContext.Unrestricted()), Labels());

    private static JournalEntriesController Journal(PakoDbContext db) =>
        new(db, new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>(), Labels())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

    private record ExportCase(string Name, Func<Seed, Task<IActionResult>> Run, int HeaderRow, string SheetEn, string SheetSq, string[] HeadersEn, string[] HeadersSq);

    private static readonly string[] Section3En = { "Section", "Account Code", "Account Name", "Amount" };
    private static readonly string[] Section3Sq = { "Seksioni", "Shifra", "Emërtimi", "Shuma" };

    private static IEnumerable<ExportCase> Cases()
    {
        yield return new("ProfitAndLoss", s => Reports(s.Db).ProfitAndLossExport(s.CompanyId, From, To), 1,
            "Profit and Loss", "Fitimi dhe Humbja", Section3En, Section3Sq);
        yield return new("BalanceSheet", s => Reports(s.Db).BalanceSheetExport(s.CompanyId, To), 1,
            "Balance Sheet", "Bilanci i gjendjes", Section3En, Section3Sq);
        yield return new("VatReturn", s => Reports(s.Db).VatReturnExport(s.CompanyId, From, To), 1,
            "VAT Return", "Deklarata e TVSH-së",
            new[] { "Direction", "Tax Code", "Rate", "Amount" }, new[] { "Drejtimi", "Kodi i tatimit", "Shkalla", "Shuma" });
        yield return new("TrialBalance", s => Ledger(s.Db).TrialBalanceExport(s.CompanyId, From, To), 1,
            "Trial Balance", "Gjendja e llogarive",
            new[] { "Account Code", "Account Name", "Opening", "Debit", "Credit", "Closing" },
            new[] { "Shifra", "Emërtimi", "Gjendja fillestare", "Debi", "Kredi", "Gjendja përfundimtare" });
        yield return new("MonthlyPnl", s => Statements(s.Db).MonthlyProfitAndLossExport(s.CompanyId, 2026), 1,
            "Monthly P&L", "Fitimi dhe humbja mujore",
            new[] { "Section", "Account Code", "Account Name" }.Concat(Months).Append("Total").ToArray(),
            new[] { "Seksioni", "Shifra", "Emërtimi" }.Concat(MonthsSq).Append("Gjithsejt").ToArray());
        yield return new("ComparativeBalanceSheet", s => Statements(s.Db).BalanceSheetComparativeExport(s.CompanyId, To, From), 1,
            "Comparative Balance Sheet", "Bilanci krahasues",
            new[] { "Section", "Account Code", "Account Name", "Current", "Prior", "Difference" },
            new[] { "Seksioni", "Shifra", "Emërtimi", "Aktuale", "Më parë", "Diferenca" });
        yield return new("CashFlow", s => Statements(s.Db).CashFlowExport(s.CompanyId, From, To), 1,
            "Cash Flow", "Rrjedha e parasë", Section3En, Section3Sq);
        yield return new("EquityStatement", s => Statements(s.Db).EquityStatementExport(s.CompanyId, From, To), 1,
            "Equity Statement", "Ekuiteti i Pronarëve", Section3En, Section3Sq);
        yield return new("GeneralLedger", s => GeneralLedger(s.Db).GeneralLedgerExport(s.CompanyId, From, To, null, null), 1,
            "General Ledger", "Libri i madh",
            new[] { "Date", "Entry", "Document type", "Document number", "Account code", "Account name", "Partner", "Description", "Debit", "Credit" },
            new[] { "Data", "Regjistrimi", "Lloji i dokumentit", "Numri i dokumentit", "Shifra e llogarisë", "Emërtimi i llogarisë", "Partneri", "Përshkrimi", "Debi", "Kredi" });
        yield return new("ExpenseBook", s => ExpenseBook(s.Db).ExpenseBookExport(s.CompanyId, From, To), 1,
            "Expense Book", "Libri i shpenzimeve",
            new[] { "Date", "Document", "Partner", "Total" }, new[] { "Data", "Dokumenti", "Partneri", "Gjithsejt" });
        yield return new("VendorSynthetic", s => Payables(s.Db).VendorSyntheticExport(s.CompanyId, From, To, true), 1,
            "Vendor Balances", "Sintetika e furnitorëve",
            new[] { "Vendor", "Opening", "Debit", "Credit", "Closing" },
            new[] { "Furnitori", "Gjendja fillestare", "Debi", "Kredi", "Gjendja përfundimtare" });
        yield return new("VendorStatement", s => Payables(s.Db).VendorStatementExport(s.CompanyId, s.PartnerId, From, To), 5,
            "Vendor Statement", "Analitika e furnitorit",
            new[] { "Date", "Type", "Document", "Description", "Debit", "Credit", "Balance" },
            new[] { "Data", "Tipi", "Dokumenti", "Përshkrimi", "Debi", "Kredi", "Bilanci" });
        yield return new("PayablesAging", s => Payables(s.Db).PayablesAgingExport(s.CompanyId, To), 1,
            "Payables Aging", "Vjetërsia e borxheve",
            new[] { "Bill", "Vendor", "Issue date", "Due date", "Outstanding", "Bucket" },
            new[] { "Fatura e blerjes", "Furnitori", "Data e lëshimit", "Afati i pagesës", "E papaguar", "Grupi" });
        yield return new("PurchasesByVendor", s => Payables(s.Db).PurchasesByVendorExport(s.CompanyId, From, To), 1,
            "Purchases by Vendor", "Blerjet sipas furnitorit",
            new[] { "Vendor", "Net", "Discount", "VAT", "Gross" },
            new[] { "Furnitori", "Vlera pa TVSH", "Zbritja", "TVSH", "Vlera me TVSH" });
        yield return new("PurchasesByItem", s => Payables(s.Db).PurchasesByItemExport(s.CompanyId, From, To), 1,
            "Purchases by Item", "Blerjet sipas artikujve",
            new[] { "Item Code", "Description", "Unit", "Quantity", "Net", "VAT", "Gross" },
            new[] { "Shifra e artikullit", "Përshkrimi", "Njësia", "Sasia", "Vlera pa TVSH", "TVSH", "Vlera me TVSH" });
        yield return new("PurchaseTransactions", s => Payables(s.Db).PurchaseTransactionsExport(s.CompanyId, From, To, null), 1,
            "Purchase Transactions", "Detajet e transaksioneve",
            new[] { "Date", "Document", "Type", "Vendor", "Item Code", "Description", "Quantity", "Unit Price", "Net", "VAT", "Gross" },
            new[] { "Data", "Dokumenti", "Tipi", "Furnitori", "Shifra e artikullit", "Përshkrimi", "Sasia", "Çmimi për njësi", "Vlera pa TVSH", "TVSH", "Vlera me TVSH" });
    }

    public static IEnumerable<object[]> CaseNames() => Cases().Select(c => new object[] { c.Name });

    private static async Task<IXLWorksheet> RunAsync(Seed s, ExportCase c, string culture)
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = new CultureInfo(culture);
        try
        {
            var result = await c.Run(s);
            var file = Assert.IsType<FileContentResult>(result);
            var workbook = new XLWorkbook(new MemoryStream(file.FileContents));
            return workbook.Worksheet(1);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static string[] HeaderRow(IXLWorksheet sheet, int row, int count) =>
        Enumerable.Range(1, count).Select(col => sheet.Cell(row, col).GetString()).ToArray();

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task Export_HeadersAreAlbanianUnderSq(string name)
    {
        var s = await SeedAsync();
        var c = Cases().Single(x => x.Name == name);

        var sheet = await RunAsync(s, c, "sq");

        Assert.Equal(c.HeadersSq, HeaderRow(sheet, c.HeaderRow, c.HeadersSq.Length));
        Assert.Equal(c.SheetSq, sheet.Name);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task Export_HeadersAreUnchangedEnglishUnderEn(string name)
    {
        var s = await SeedAsync();
        var c = Cases().Single(x => x.Name == name);

        var sheet = await RunAsync(s, c, "en");

        Assert.Equal(c.HeadersEn, HeaderRow(sheet, c.HeaderRow, c.HeadersEn.Length));
        Assert.Equal(c.SheetEn, sheet.Name);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task Export_NoCellIsARawResourceKey(string name)
    {
        var s = await SeedAsync();
        var c = Cases().Single(x => x.Name == name);

        foreach (var culture in new[] { "en", "sq" })
        {
            var sheet = await RunAsync(s, c, culture);
            Assert.DoesNotContain(sheet.CellsUsed(), cell => cell.GetString().StartsWith("Export_", StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task JournalEntryExport_HeadersFollowCulture()
    {
        var s = await SeedAsync();
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("sq");
            var sq = new XLWorkbook(new MemoryStream(Assert.IsType<FileContentResult>(await Journal(s.Db).Export(s.CompanyId, s.EntryId)).FileContents)).Worksheet(1);
            Assert.Equal(new[] { "Shifra", "Emërtimi", "Partneri", "Debi", "Kredi", "Përshkrimi" }, HeaderRow(sq, 1, 6));

            CultureInfo.CurrentUICulture = new CultureInfo("en");
            var en = new XLWorkbook(new MemoryStream(Assert.IsType<FileContentResult>(await Journal(s.Db).Export(s.CompanyId, s.EntryId)).FileContents)).Worksheet(1);
            Assert.Equal(new[] { "Account Code", "Account Name", "Partner", "Debit", "Credit", "Description" }, HeaderRow(en, 1, 6));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public async Task GeneralLedgerExport_TotalLabelAndDateFormatFollowCulture()
    {
        var s = await SeedAsync();
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("sq");
            var sheet = new XLWorkbook(new MemoryStream(Assert.IsType<FileContentResult>(await GeneralLedger(s.Db).GeneralLedgerExport(s.CompanyId, From, To, null, null)).FileContents)).Worksheet(1);
            Assert.Equal(XLDataType.DateTime, sheet.Cell(2, 1).DataType);
            Assert.Equal("dd.mm.yyyy", sheet.Cell(2, 1).Style.DateFormat.Format);
            Assert.Equal("Gjithsejt", sheet.Cell(sheet.LastRowUsed()!.RowNumber(), 8).GetString());
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public void ExportLabels_MissingKeyFallsBackToReadableText()
    {
        Assert.Equal("Nonexistent", Labels()["Common_Nonexistent"]);
    }
}
