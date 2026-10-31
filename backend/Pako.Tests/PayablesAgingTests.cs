using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class PayablesAgingTests : IAsyncLifetime
{
    private static readonly DateOnly AsOf = new(2026, 6, 30);
    private static readonly string[] Order = { "Current", "1-30", "31-45", "46-60", "61-90", "91-180", "181-360", "Over360" };

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
        public required Account Cash { get; init; }
        public required Account Expense { get; init; }
        public required Journal Purchases { get; init; }
        public required Journal Bank { get; init; }
    }

    private async Task<Env> NewEnvAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        Account Acc(string code, string name, AccountType type) =>
            new() { Id = Guid.NewGuid(), CompanyId = company.Id, Code = code, Name = name, AccountType = type };
        var cash = Acc("1000", "Bank", AccountType.Cash);
        var payable = Acc("2000", "Accounts Payable", AccountType.Payable);
        var expense = Acc("6000", "Expense", AccountType.Expense);
        db.Companies.Add(company);
        db.Accounts.AddRange(cash, payable, expense);
        var purchases = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Purchase, Code = "PUR", Name = "Purchases" };
        var bank = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank" };
        db.Journals.AddRange(purchases, bank);
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = Guid.NewGuid(),
            PayableAccountId = payable.Id,
            RevenueAccountId = Guid.NewGuid(),
            ExpenseAccountId = expense.Id,
            CustomerDepositsAccountId = Guid.NewGuid()
        });
        await db.SaveChangesAsync();
        return new Env { Db = db, Company = company, Payable = payable, Cash = cash, Expense = expense, Purchases = purchases, Bank = bank };
    }

    private static Partner AddVendor(Env e, string name)
    {
        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = e.Company.Id, Name = name, IsVendor = true };
        e.Db.Partners.Add(partner);
        return partner;
    }

    private static Bill PostBill(
        Env e, Partner vendor, string number, decimal amount, DateOnly due,
        DocumentType type = DocumentType.Bill, Guid? payableAccountId = null)
    {
        var bill = new Bill
        {
            Id = Guid.NewGuid(),
            CompanyId = e.Company.Id,
            PartnerId = vendor.Id,
            VendorReference = number,
            IssueDate = due.AddDays(-30),
            DueDate = due,
            DocumentType = type,
            Lines = { new BillLine { Id = Guid.NewGuid(), Description = "Goods", Quantity = 1m, UnitPrice = amount, ExpenseAccountId = e.Expense.Id } }
        };
        var entry = bill.Post(
            e.Company, e.Purchases.Id, payableAccountId ?? e.Payable.Id, new TaxComputationService(),
            new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        e.Db.Bills.Add(bill);
        e.Db.JournalEntries.Add(entry);
        return bill;
    }

    private static void Pay(Env e, Partner vendor, Bill bill, decimal amount, DateOnly? date = null)
    {
        var line = new JournalEntryLine { Id = Guid.NewGuid(), AccountId = e.Payable.Id, Debit = amount, PartnerId = vendor.Id };
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = e.Company.Id,
            JournalId = e.Bank.Id,
            Date = date ?? bill.DueDate,
            Reference = "PAY-" + bill.VendorReference,
            Lines =
            {
                line,
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = e.Cash.Id, Credit = amount }
            }
        };
        entry.Post(e.Company);
        e.Db.JournalEntries.Add(entry);
        e.Db.Reconciliations.Add(Reconciliation.ForBill(e.Company.Id, bill.Id, line.Id, amount));
    }

    private static PayablesReportsController Controller(PakoDbContext db, CompanyAccessContext? access = null)
    {
        access ??= CompanyAccessContext.Unrestricted();
        return new(new NullStringLocalizer<ErrorMessages>(), access, new VendorLedgerService(db, access), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));
    }

    private static async Task<PayablesAgingResponse> Aging(PakoDbContext db, Guid companyId, CompanyAccessContext? access = null) =>
        Assert.IsType<PayablesAgingResponse>(Assert.IsType<OkObjectResult>((await Controller(db, access).PayablesAging(companyId, AsOf)).Result).Value);

    private static async Task<PayablesAgingResponse> AgingAt(PakoDbContext db, Guid companyId, DateOnly asOf) =>
        Assert.IsType<PayablesAgingResponse>(Assert.IsType<OkObjectResult>((await Controller(db).PayablesAging(companyId, asOf)).Result).Value);

    [Fact]
    public async Task PayablesAging_ExcludesBillsIssuedAfterAsOf()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Alpha");
        PostBill(e, vendor, "B-ON", 300m, AsOf.AddDays(30));
        PostBill(e, vendor, "B-LATE", 700m, AsOf.AddDays(31));
        await e.Db.SaveChangesAsync();

        var r = await Aging(e.Db, e.Company.Id);

        var line = Assert.Single(r.Lines);
        Assert.Equal("B-ON", line.BillNumber);
        Assert.Equal(300m, line.Outstanding);
        Assert.Equal(300m, r.Buckets.Sum(b => b.Total));
    }

    [Fact]
    public async Task PayablesAging_IgnoresPaymentsAfterAsOf()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Alpha");
        var bill = PostBill(e, vendor, "B-1", 1000m, AsOf.AddDays(-10));
        Pay(e, vendor, bill, 400m, AsOf.AddDays(5));
        await e.Db.SaveChangesAsync();

        var before = Assert.Single((await Aging(e.Db, e.Company.Id)).Lines);
        var onPaymentDay = Assert.Single((await AgingAt(e.Db, e.Company.Id, AsOf.AddDays(5))).Lines);

        Assert.Equal(1000m, before.Outstanding);
        Assert.Equal(600m, onPaymentDay.Outstanding);
    }

    [Fact]
    public async Task PayablesAging_BucketsByDaysOverdue()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Alpha");
        var cases = new (int Days, string Bucket)[]
        {
            (0, "Current"), (1, "1-30"), (30, "1-30"), (31, "31-45"), (45, "31-45"), (46, "46-60"), (60, "46-60"),
            (61, "61-90"), (90, "61-90"), (91, "91-180"), (180, "91-180"), (181, "181-360"), (360, "181-360"), (361, "Over360"),
        };
        foreach (var c in cases)
        {
            PostBill(e, vendor, $"B-{c.Days:000}", 10m + c.Days, AsOf.AddDays(-c.Days));
        }

        PostBill(e, vendor, "B-FUTURE", 5m, AsOf.AddDays(15));
        await e.Db.SaveChangesAsync();

        var r = await Aging(e.Db, e.Company.Id);

        Assert.Equal(AsOf, r.AsOf);
        Assert.Equal(cases.Length + 1, r.Lines.Count);
        foreach (var c in cases)
        {
            var line = Assert.Single(r.Lines, l => l.BillNumber == $"B-{c.Days:000}");
            Assert.Equal(c.Bucket, line.Bucket);
            Assert.Equal(10m + c.Days, line.Outstanding);
            Assert.Equal("Alpha", line.PartnerName);
        }

        Assert.Equal("Current", r.Lines.Single(l => l.BillNumber == "B-FUTURE").Bucket);
        Assert.Equal(Order, r.Buckets.Select(b => b.Bucket));
        Assert.Equal(10m + 5m, r.Buckets[0].Total);
        Assert.Equal(11m + 40m, r.Buckets[1].Total);
        Assert.Equal(41m + 55m, r.Buckets[2].Total);
        Assert.Equal(56m + 70m, r.Buckets[3].Total);
        Assert.Equal(71m + 100m, r.Buckets[4].Total);
        Assert.Equal(101m + 190m, r.Buckets[5].Total);
        Assert.Equal(191m + 370m, r.Buckets[6].Total);
        Assert.Equal(371m, r.Buckets[7].Total);
        Assert.Equal(r.Lines.OrderBy(l => l.DueDate).ThenBy(l => l.BillNumber, StringComparer.Ordinal).Select(l => l.BillId), r.Lines.Select(l => l.BillId));
    }

    [Fact]
    public async Task PayablesAging_PartiallyPaidBillShowsRemainder()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Alpha");
        var bill = PostBill(e, vendor, "B-1", 1000m, AsOf.AddDays(-10));
        Pay(e, vendor, bill, 400m);
        await e.Db.SaveChangesAsync();

        var r = await Aging(e.Db, e.Company.Id);

        var line = Assert.Single(r.Lines);
        Assert.Equal(600m, line.Outstanding);
        Assert.Equal("1-30", line.Bucket);
        Assert.Equal(600m, r.Buckets.Single(b => b.Bucket == "1-30").Total);
    }

    [Fact]
    public async Task PayablesAging_FullyPaidBillExcluded()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Alpha");
        var paid = PostBill(e, vendor, "B-PAID", 500m, AsOf.AddDays(-10));
        PostBill(e, vendor, "B-OPEN", 200m, AsOf.AddDays(-10));
        Pay(e, vendor, paid, 500m);
        await e.Db.SaveChangesAsync();

        var r = await Aging(e.Db, e.Company.Id);

        var line = Assert.Single(r.Lines);
        Assert.Equal("B-OPEN", line.BillNumber);
        Assert.Equal(200m, r.Buckets.Sum(b => b.Total));
    }

    [Fact]
    public async Task PayablesAging_ExcludesCreditNotesDraftsAndPartnerPayableOverride()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Alpha");
        var other = new Account { Id = Guid.NewGuid(), CompanyId = e.Company.Id, Code = "2100", Name = "Foreign Payable", AccountType = AccountType.Payable };
        e.Db.Accounts.Add(other);
        var foreign = AddVendor(e, "Foreign");
        foreign.PayableAccountId = other.Id;
        PostBill(e, vendor, "B-1", 100m, AsOf.AddDays(-5));
        PostBill(e, vendor, "CN-1", 40m, AsOf.AddDays(-5), DocumentType.CreditNote);
        PostBill(e, foreign, "B-F", 70m, AsOf.AddDays(-5), payableAccountId: other.Id);
        e.Db.Bills.Add(new Bill
        {
            Id = Guid.NewGuid(), CompanyId = e.Company.Id, PartnerId = vendor.Id, VendorReference = "B-DRAFT",
            IssueDate = AsOf, DueDate = AsOf.AddDays(-5)
        });
        await e.Db.SaveChangesAsync();

        var r = await Aging(e.Db, e.Company.Id);

        Assert.Equal(new[] { "B-1", "B-F" }, r.Lines.Select(l => l.BillNumber).OrderBy(n => n).ToArray());
        Assert.Equal(170m, r.Lines.Sum(l => l.Outstanding));
    }

    [Fact]
    public async Task PayablesAging_BucketTotalsSumToPayablesBalance()
    {
        var e = await NewEnvAsync();
        var alpha = AddVendor(e, "Alpha");
        var beta = AddVendor(e, "Beta");
        var b1 = PostBill(e, alpha, "B-1", 1000m, AsOf.AddDays(-5));
        PostBill(e, alpha, "B-2", 250m, AsOf.AddDays(-50));
        var b3 = PostBill(e, beta, "B-3", 300m, AsOf.AddDays(-400));
        PostBill(e, beta, "B-4", 80m, AsOf.AddDays(20));
        Pay(e, alpha, b1, 400m);
        Pay(e, beta, b3, 300m);
        await e.Db.SaveChangesAsync();

        var r = await Aging(e.Db, e.Company.Id);
        var control = await new VendorLedgerService(e.Db, CompanyAccessContext.Unrestricted()).PayablesControlBalanceAsync(e.Company.Id, AsOf);

        Assert.Equal(600m + 250m + 80m, r.Lines.Sum(l => l.Outstanding));
        Assert.Equal(r.Lines.Sum(l => l.Outstanding), r.Buckets.Sum(b => b.Total));
        Assert.Equal(930m, control);
        Assert.Equal(control, r.Buckets.Sum(b => b.Total));
    }

    [Fact]
    public async Task PayablesAging_RestrictedUserSeesOnlyVisiblePartners()
    {
        var e = await NewEnvAsync();
        var alpha = AddVendor(e, "Alpha");
        var beta = AddVendor(e, "Beta");
        PostBill(e, alpha, "B-A", 100m, AsOf.AddDays(-5));
        PostBill(e, beta, "B-B", 900m, AsOf.AddDays(-5));
        await e.Db.SaveChangesAsync();
        var department = new Department
        {
            Id = Guid.NewGuid(), CompanyId = e.Company.Id, Code = "PUR", Name = "Purchasing",
            PurchasesAccess = AccessLevel.Write, ReportsAccess = AccessLevel.Read, PartnerScope = PartnerScope.Assigned
        };
        var access = CompanyAccessContext.ForStaff(e.Company.Id, Guid.NewGuid(), Guid.NewGuid(), department, new HashSet<Guid> { alpha.Id });

        var r = await Aging(e.Db, e.Company.Id, access);

        var line = Assert.Single(r.Lines);
        Assert.Equal("B-A", line.BillNumber);
        Assert.Equal(100m, r.Buckets.Sum(b => b.Total));
    }

    [Fact]
    public async Task PayablesAging_EmptyCompany_ReturnsEightZeroBuckets()
    {
        var e = await NewEnvAsync();

        var r = await Aging(e.Db, e.Company.Id);

        Assert.Empty(r.Lines);
        Assert.Equal(Order, r.Buckets.Select(b => b.Bucket));
        Assert.All(r.Buckets, b => Assert.Equal(0m, b.Total));
    }

    [Fact]
    public async Task PayablesAgingExport_ContainsBillRowsAndBucketTotals()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Alpha");
        PostBill(e, vendor, "B-1", 100m, AsOf.AddDays(-5));
        await e.Db.SaveChangesAsync();

        var result = await Controller(e.Db).PayablesAgingExport(e.Company.Id, AsOf);

        var file = Assert.IsType<FileContentResult>(result);
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Bill", sheet.Cell(1, 1).GetString());
        Assert.Equal("B-1", sheet.Cell(2, 1).GetString());
        Assert.Equal("Alpha", sheet.Cell(2, 2).GetString());
        Assert.Equal(100m, sheet.Cell(2, 5).GetValue<decimal>());
        Assert.Equal("1-30", sheet.Cell(2, 6).GetString());
        Assert.Contains(sheet.RowsUsed(), r => r.Cell(1).GetString() == "Total" && r.Cell(5).GetValue<decimal>() == 100m);
    }

    [Fact]
    public async Task PayablesAging_SubCentResidual_Excluded()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Rounding Vendor");
        var bill = PostBill(e, vendor, "B-ROUND", 100m, new DateOnly(2026, 6, 1));
        Pay(e, vendor, bill, 99.99m, bill.DueDate);
        await e.Db.SaveChangesAsync();

        var result = await new VendorLedgerService(e.Db, CompanyAccessContext.Unrestricted()).PayablesAgingAsync(e.Company.Id, AsOf);

        Assert.Empty(result.Lines);
    }

    private async Task<(Env Env, Partner Alpha, Partner Beta)> SeedMatrixAsync()
    {
        var e = await NewEnvAsync();
        var alpha = AddVendor(e, "Alpha");
        var beta = AddVendor(e, "Beta");
        PostBill(e, alpha, "A-CUR", 300m, AsOf.AddDays(30));
        var a2 = PostBill(e, alpha, "A-10", 200m, AsOf.AddDays(-10));
        PostBill(e, alpha, "A-OLD", 100m, AsOf.AddDays(-400));
        PostBill(e, beta, "B-50", 50m, AsOf.AddDays(-50));
        PostBill(e, beta, "B-CUR", 25m, AsOf.AddDays(5));
        Pay(e, alpha, a2, 80m, AsOf.AddDays(-5));
        await e.Db.SaveChangesAsync();
        return (e, alpha, beta);
    }

    [Fact]
    public async Task PayablesAging_VendorMatrix_RowsSumToLinesAndColumnsToBucketTotals()
    {
        var (e, alpha, beta) = await SeedMatrixAsync();

        var aging = await Aging(e.Db, e.Company.Id);

        Assert.Equal(new[] { "Alpha", "Beta" }, aging.VendorMatrix.Select(v => v.PartnerName));
        var a = aging.VendorMatrix.Single(v => v.PartnerId == alpha.Id);
        var b = aging.VendorMatrix.Single(v => v.PartnerId == beta.Id);
        Assert.Equal(Order, a.Buckets.Select(x => x.Bucket));
        Assert.Equal(new[] { 300m, 120m, 0m, 0m, 0m, 0m, 0m, 100m }, a.Buckets.Select(x => x.Total));
        Assert.Equal(520m, a.Total);
        Assert.Equal(new[] { 25m, 0m, 0m, 50m, 0m, 0m, 0m, 0m }, b.Buckets.Select(x => x.Total));
        Assert.Equal(75m, b.Total);
        foreach (var row in aging.VendorMatrix)
        {
            Assert.Equal(aging.Lines.Where(l => l.PartnerId == row.PartnerId).Sum(l => l.Outstanding), row.Total);
            Assert.Equal(row.Buckets.Sum(x => x.Total), row.Total);
        }

        for (var i = 0; i < Order.Length; i++)
        {
            Assert.Equal(aging.Buckets[i].Total, aging.VendorMatrix.Sum(v => v.Buckets[i].Total));
        }

        Assert.Equal(aging.Lines.Sum(l => l.Outstanding), aging.VendorMatrix.Sum(v => v.Total));
    }

    [Fact]
    public async Task PayablesAging_Export_HasMatrixSheetWithTotalsRow()
    {
        var (e, _, _) = await SeedMatrixAsync();

        var file = Assert.IsType<FileContentResult>(await Controller(e.Db).PayablesAgingExport(e.Company.Id, AsOf));

        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(file.FileContents));
        Assert.Equal(2, workbook.Worksheets.Count);
        var matrix = workbook.Worksheet(2);
        Assert.Equal("Matrix", matrix.Name);
        Assert.Equal(new[] { "Vendor", "Current", "1-30", "31-45", "46-60", "61-90", "91-180", "181-360", "Over360", "Total" },
            Enumerable.Range(1, 10).Select(c => matrix.Cell(1, c).GetString()));
        Assert.Equal(new[] { 300m, 120m, 0m, 0m, 0m, 0m, 0m, 100m, 520m }, Enumerable.Range(2, 9).Select(c => matrix.Cell(2, c).GetValue<decimal>()));
        Assert.Equal("Beta", matrix.Cell(3, 1).GetString());
        Assert.Equal("Total", matrix.Cell(4, 1).GetString());
        Assert.Equal(new[] { 325m, 120m, 0m, 50m, 0m, 0m, 0m, 100m, 595m }, Enumerable.Range(2, 9).Select(c => matrix.Cell(4, c).GetValue<decimal>()));
    }

    [Fact]
    public async Task PayablesAging_Export_BucketNamesTranslateUnderSqAndStayEnglishUnderEn()
    {
        var (e, _, _) = await SeedMatrixAsync();
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("sq");
            var sq = Assert.IsType<FileContentResult>(await Controller(e.Db).PayablesAgingExport(e.Company.Id, AsOf));
            using var sqBook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(sq.FileContents));
            var sqLines = sqBook.Worksheet(1);
            Assert.Contains(sqLines.RowsUsed().Skip(1), r => r.Cell(6).GetString() == "Pa vonuar");
            Assert.Contains(sqLines.RowsUsed().Skip(1), r => r.Cell(6).GetString() == "Mbi 360");
            Assert.Contains(sqLines.RowsUsed().Skip(1), r => r.Cell(6).GetString() == "1-30");
            Assert.Equal("Matrica", sqBook.Worksheet(2).Name);
            Assert.Equal("Pa vonuar", sqBook.Worksheet(2).Cell(1, 2).GetString());
            Assert.Equal("Mbi 360", sqBook.Worksheet(2).Cell(1, 9).GetString());

            CultureInfo.CurrentUICulture = new CultureInfo("en");
            var en = Assert.IsType<FileContentResult>(await Controller(e.Db).PayablesAgingExport(e.Company.Id, AsOf));
            using var enBook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(en.FileContents));
            Assert.Contains(enBook.Worksheet(1).RowsUsed().Skip(1), r => r.Cell(6).GetString() == "Over360");
            Assert.Equal("Current", enBook.Worksheet(2).Cell(1, 2).GetString());

            var json = await Aging(e.Db, e.Company.Id);
            Assert.Contains(json.Lines, l => l.Bucket == "Over360");
            Assert.Contains(json.Buckets, b => b.Bucket == "Current");
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public async Task VendorStatement_CarriesTotalDebitAndCredit_InJsonAndExportClosingBlock()
    {
        var e = await NewEnvAsync();
        var vendor = AddVendor(e, "Alpha");
        var bill = PostBill(e, vendor, "A-1", 500m, AsOf.AddDays(-20));
        Pay(e, vendor, bill, 200m, AsOf.AddDays(-5));
        await e.Db.SaveChangesAsync();
        var from = new DateOnly(2026, 1, 1);

        var json = Assert.IsType<VendorStatementResponse>(
            Assert.IsType<OkObjectResult>((await Controller(e.Db).VendorStatement(e.Company.Id, vendor.Id, from, AsOf)).Result).Value);
        Assert.Equal(200m, json.TotalDebit);
        Assert.Equal(500m, json.TotalCredit);
        Assert.Equal(300m, json.Closing);

        var previous = CultureInfo.CurrentUICulture;
        try
        {
            foreach (var (culture, total, purchase, bank) in new[] { ("en", "Total", "Purchase", "Bank"), ("sq", "Gjithsejt", "Blerje", "Banka") })
            {
                CultureInfo.CurrentUICulture = new CultureInfo(culture);
                var file = Assert.IsType<FileContentResult>(await Controller(e.Db).VendorStatementExport(e.Company.Id, vendor.Id, from, AsOf));
                using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(file.FileContents));
                var sheet = workbook.Worksheet(1);
                var totalRow = sheet.RowsUsed().Single(r => r.Cell(2).GetString() == total);
                Assert.Equal(200m, totalRow.Cell(5).GetValue<decimal>());
                Assert.Equal(500m, totalRow.Cell(6).GetValue<decimal>());
                Assert.Contains(sheet.RowsUsed(), r => r.Cell(2).GetString() == purchase);
                Assert.Contains(sheet.RowsUsed(), r => r.Cell(2).GetString() == bank);
            }
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }
}
