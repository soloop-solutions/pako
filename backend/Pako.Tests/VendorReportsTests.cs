using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

public class VendorReportsTests : IAsyncLifetime
{
    private static readonly DateOnly Jan1 = new(2026, 1, 1);
    private static readonly DateOnly Jan31 = new(2026, 1, 31);

    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid Alpha, Guid Beta, Guid Gamma, Guid Zeta);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        Account Acc(string code, string name, AccountType type) =>
            new() { Id = Guid.NewGuid(), CompanyId = company.Id, Code = code, Name = name, AccountType = type };
        var cash = Acc("1000", "Bank", AccountType.Cash);
        var payable = Acc("2000", "Accounts Payable", AccountType.Payable);
        var rent = Acc("6000", "Rent", AccountType.Expense);
        db.Companies.Add(company);
        db.Accounts.AddRange(cash, payable, rent);
        var purchases = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Purchase, Code = "PUR", Name = "Purchases" };
        var bank = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank" };
        db.Journals.AddRange(purchases, bank);

        var alpha = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Alpha Supplies", IsVendor = true };
        var beta = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Beta Services", IsVendor = true };
        var gamma = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Gamma Settled", IsVendor = true };
        var zeta = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Zeta Idle", IsVendor = true };
        db.Partners.AddRange(alpha, beta, gamma, zeta);

        void Bill(Partner vendor, DateOnly date, decimal amount, string reference) =>
            Post(db, company, purchases, date, reference, (rent, amount, 0m, null), (payable, 0m, amount, vendor.Id));
        void Payment(Partner vendor, DateOnly date, decimal amount, string reference) =>
            Post(db, company, bank, date, reference, (payable, amount, 0m, vendor.Id), (cash, 0m, amount, null));

        Bill(alpha, new DateOnly(2025, 12, 10), 1000m, "BILL-A1");
        Bill(alpha, new DateOnly(2026, 1, 5), 500m, "BILL-A2");
        Payment(alpha, new DateOnly(2026, 1, 20), 700m, "PAY-A1");
        Bill(beta, new DateOnly(2026, 1, 10), 300m, "BILL-B1");
        Payment(beta, new DateOnly(2026, 1, 25), 400m, "PAY-B1");
        Bill(gamma, new DateOnly(2025, 11, 5), 200m, "BILL-G1");
        Payment(gamma, new DateOnly(2025, 12, 5), 200m, "PAY-G1");

        await db.SaveChangesAsync();
        return new Seed(db, company.Id, alpha.Id, beta.Id, gamma.Id, zeta.Id);
    }

    private static void Post(
        PakoDbContext db, Company company, Journal journal, DateOnly date, string reference,
        params (Account Account, decimal Debit, decimal Credit, Guid? PartnerId)[] lines)
    {
        var entry = new JournalEntry { Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = journal.Id, Date = date, Reference = reference };
        foreach (var l in lines)
        {
            entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = l.Account.Id, Debit = l.Debit, Credit = l.Credit, PartnerId = l.PartnerId });
        }

        entry.Post(company);
        db.JournalEntries.Add(entry);
    }

    private static PayablesReportsController Controller(PakoDbContext db, CompanyAccessContext? access = null)
    {
        access ??= CompanyAccessContext.Unrestricted();
        return new(new NullStringLocalizer<ErrorMessages>(), access, new VendorLedgerService(db, access), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));
    }

    private static ReportChecksController Checks(PakoDbContext db) =>
        new(new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db),
            new TaxReportService(db, CompanyAccessContext.Unrestricted()), new VendorLedgerService(db, CompanyAccessContext.Unrestricted()));

    private static async Task<VendorSyntheticResponse> Synthetic(
        PayablesReportsController controller, Guid companyId, DateOnly from, DateOnly to, bool includeZero = false) =>
        Assert.IsType<VendorSyntheticResponse>(Assert.IsType<OkObjectResult>((await controller.VendorSynthetic(companyId, from, to, includeZero)).Result).Value);

    private static async Task<VendorStatementResponse> Statement(
        PayablesReportsController controller, Guid companyId, Guid partnerId, DateOnly from, DateOnly to) =>
        Assert.IsType<VendorStatementResponse>(Assert.IsType<OkObjectResult>((await controller.VendorStatement(companyId, partnerId, from, to)).Result).Value);

    [Fact]
    public async Task VendorSynthetic_OpeningDebitCreditClosingReconcile()
    {
        var s = await SeedAsync();

        var r = await Synthetic(Controller(s.Db), s.CompanyId, Jan1, Jan31);

        Assert.Equal(2, r.Lines.Count);
        var alpha = r.Lines[0];
        Assert.Equal("Alpha Supplies", alpha.Name);
        Assert.Equal(1000m, alpha.Opening);
        Assert.Equal(700m, alpha.Debit);
        Assert.Equal(500m, alpha.Credit);
        Assert.Equal(800m, alpha.Closing);
        var beta = r.Lines[1];
        Assert.Equal("Beta Services", beta.Name);
        Assert.Equal(0m, beta.Opening);
        Assert.Equal(400m, beta.Debit);
        Assert.Equal(300m, beta.Credit);
        Assert.Equal(-100m, beta.Closing);
        Assert.All(r.Lines, l => Assert.Equal(l.Opening + l.Credit - l.Debit, l.Closing));
        Assert.Equal(700m, r.TotalClosing);
    }

    [Fact]
    public async Task VendorSynthetic_TotalEqualsPayablesControlAccount_Check6()
    {
        var s = await SeedAsync();

        var synthetic = await Synthetic(Controller(s.Db), s.CompanyId, Jan1, Jan31);
        var response = Assert.IsType<ReportChecksResponse>(Assert.IsType<OkObjectResult>((await Checks(s.Db).Checks(s.CompanyId, Jan1, Jan31)).Result).Value);

        var check = response.Checks.Single(c => c.Key == "vendor-total-matches-payables");
        Assert.True(check.Passed);
        Assert.Equal(700m, check.Expected);
        Assert.Equal(700m, check.Actual);
        Assert.Equal(synthetic.TotalClosing, check.Actual);
    }

    [Fact]
    public async Task VendorSynthetic_KeepsCreditBalanceVendors()
    {
        var s = await SeedAsync();

        var r = await Synthetic(Controller(s.Db), s.CompanyId, Jan1, Jan31);

        var beta = Assert.Single(r.Lines, l => l.PartnerId == s.Beta);
        Assert.Equal(-100m, beta.Closing);
        Assert.Equal(700m, r.TotalClosing);
    }

    [Fact]
    public async Task VendorSynthetic_HidesZeroVendorsByDefault()
    {
        var s = await SeedAsync();
        var controller = Controller(s.Db);

        var hidden = await Synthetic(controller, s.CompanyId, Jan1, Jan31);
        Assert.DoesNotContain(hidden.Lines, l => l.PartnerId == s.Gamma || l.PartnerId == s.Zeta);

        var shown = await Synthetic(controller, s.CompanyId, Jan1, Jan31, includeZero: true);
        Assert.Equal(4, shown.Lines.Count);
        Assert.Equal(new[] { "Alpha Supplies", "Beta Services", "Gamma Settled", "Zeta Idle" }, shown.Lines.Select(l => l.Name));
        var gamma = Assert.Single(shown.Lines, l => l.PartnerId == s.Gamma);
        Assert.Equal(0m, gamma.Opening);
        Assert.Equal(0m, gamma.Closing);
        Assert.Equal(700m, shown.TotalClosing);
    }

    [Fact]
    public async Task VendorSynthetic_FromMinValue_ReturnsZeroOpening()
    {
        var s = await SeedAsync();

        var r = await Synthetic(Controller(s.Db), s.CompanyId, DateOnly.MinValue, Jan31);

        Assert.All(r.Lines, l => Assert.Equal(0m, l.Opening));
        var alpha = Assert.Single(r.Lines, l => l.PartnerId == s.Alpha);
        Assert.Equal(700m, alpha.Debit);
        Assert.Equal(1500m, alpha.Credit);
        Assert.Equal(800m, alpha.Closing);
        Assert.Equal(700m, r.TotalClosing);
    }

    [Fact]
    public async Task VendorSynthetic_FromAfterTo_Returns400()
    {
        var s = await SeedAsync();

        var result = await Controller(s.Db).VendorSynthetic(s.CompanyId, Jan31, Jan1);

        Assert.Equal(400, Assert.IsType<BadRequestObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task VendorSynthetic_NoVendors_ReturnsEmptyZeroTotal()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Empty Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var r = await Synthetic(Controller(db), company.Id, Jan1, Jan31);

        Assert.Empty(r.Lines);
        Assert.Equal(0m, r.TotalClosing);
    }

    [Fact]
    public async Task VendorStatement_RunningBalanceEndsAtClosing()
    {
        var s = await SeedAsync();

        var r = await Statement(Controller(s.Db), s.CompanyId, s.Alpha, Jan1, Jan31);

        Assert.Equal("Alpha Supplies", r.Name);
        Assert.Equal(1000m, r.Opening);
        Assert.Equal(2, r.Rows.Count);
        Assert.Equal(new DateOnly(2026, 1, 5), r.Rows[0].Date);
        Assert.Equal("Purchase", r.Rows[0].Type);
        Assert.Equal("BILL-A2", r.Rows[0].DocumentNumber);
        Assert.Equal(500m, r.Rows[0].Credit);
        Assert.Equal(1500m, r.Rows[0].Balance);
        Assert.Equal(800m, r.Rows[1].Balance);
        Assert.Equal(800m, r.Closing);
        Assert.Equal(r.Rows[^1].Balance, r.Closing);
    }

    [Fact]
    public async Task VendorStatement_IncludesBankPaymentRows()
    {
        var s = await SeedAsync();

        var r = await Statement(Controller(s.Db), s.CompanyId, s.Beta, Jan1, Jan31);

        var payment = Assert.Single(r.Rows, row => row.Type == "Bank");
        Assert.Equal("PAY-B1", payment.DocumentNumber);
        Assert.Equal(400m, payment.Debit);
        Assert.Equal(0m, payment.Credit);
        Assert.Equal(-100m, payment.Balance);
        Assert.Equal(-100m, r.Closing);
    }

    [Fact]
    public async Task VendorStatement_NoRows_ClosingEqualsOpening()
    {
        var s = await SeedAsync();

        var r = await Statement(Controller(s.Db), s.CompanyId, s.Alpha, new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 30));

        Assert.Empty(r.Rows);
        Assert.Equal(800m, r.Opening);
        Assert.Equal(800m, r.Closing);
    }

    [Fact]
    public async Task VendorStatement_UnknownPartner_Returns404()
    {
        var s = await SeedAsync();

        var result = await Controller(s.Db).VendorStatement(s.CompanyId, Guid.NewGuid(), Jan1, Jan31);

        Assert.Equal(404, Assert.IsType<NotFoundObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task VendorReports_OnlyVisiblePartnersForScopedUser()
    {
        var s = await SeedAsync();
        var access = CompanyAccessContext.ForStaff(s.CompanyId, Guid.NewGuid(), Guid.NewGuid(), new Department(), new HashSet<Guid> { s.Alpha });
        var controller = Controller(s.Db, access);

        var r = await Synthetic(controller, s.CompanyId, Jan1, Jan31, includeZero: true);

        var only = Assert.Single(r.Lines);
        Assert.Equal(s.Alpha, only.PartnerId);
        Assert.Equal(800m, r.TotalClosing);

        var statement = await Statement(controller, s.CompanyId, s.Alpha, Jan1, Jan31);
        Assert.Equal(800m, statement.Closing);
        var hidden = await controller.VendorStatement(s.CompanyId, s.Beta, Jan1, Jan31);
        Assert.Equal(404, Assert.IsType<NotFoundObjectResult>(hidden.Result).StatusCode);
    }

    [Fact]
    public async Task VendorSyntheticExport_HasTotalRow()
    {
        var s = await SeedAsync();

        var file = Assert.IsType<FileContentResult>(await Controller(s.Db).VendorSyntheticExport(s.CompanyId, Jan1, Jan31));

        using var workbook = new XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Vendor", sheet.Cell(1, 1).GetString());
        Assert.Equal("Total", sheet.Cell(4, 1).GetString());
        Assert.Equal(700m, sheet.Cell(4, 5).GetValue<decimal>());
    }

    [Fact]
    public async Task VendorStatementExport_HasOpeningAndClosingRows()
    {
        var s = await SeedAsync();

        var file = Assert.IsType<FileContentResult>(await Controller(s.Db).VendorStatementExport(s.CompanyId, s.Alpha, Jan1, Jan31));

        using var workbook = new XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Vendor", sheet.Cell(1, 1).GetString());
        Assert.Equal("Alpha Supplies", sheet.Cell(1, 2).GetString());
        Assert.Equal(ClosedXML.Excel.XLDataType.DateTime, sheet.Cell(2, 2).DataType);
        Assert.Equal("Opening", sheet.Cell(6, 2).GetString());
        Assert.Equal(1000m, sheet.Cell(6, 7).GetValue<decimal>());
        Assert.Equal("Total", sheet.Cell(9, 2).GetString());
        Assert.Equal("Closing", sheet.Cell(10, 2).GetString());
        Assert.Equal(800m, sheet.Cell(10, 7).GetValue<decimal>());
    }

    [Fact]
    public async Task VendorStatementExport_FromMinValue_OpeningRowHasNoDate()
    {
        var s = await SeedAsync();

        var file = Assert.IsType<FileContentResult>(await Controller(s.Db).VendorStatementExport(s.CompanyId, s.Alpha, DateOnly.MinValue, Jan31));

        using var workbook = new XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Opening", sheet.Cell(6, 2).GetString());
        Assert.True(sheet.Cell(6, 1).IsEmpty());
    }
}
