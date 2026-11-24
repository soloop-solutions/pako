using System.Security.Claims;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Banking;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

// Bank statement import (docs/BANK_STATEMENTS.md): template, reader, matcher, and confirm recording the
// same payments "Record payment" would.
public class BankStatementTests : IAsyncLifetime
{
    private static readonly TaxComputationService TaxService = new();
    private static readonly DateOnly IssueDate = new(2026, 11, 2);
    private readonly List<PakoDbContext> _dbContexts = [];

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private sealed record Seed(PakoDbContext Db, Guid CompanyId, Guid BankAccountId, Guid CustomerId, Guid VendorId, Guid UserId);

    private async Task<Seed> SeedAsync(string companyName = "Bank Co")
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = companyName, IsVatRegistered = false };
        var bank = Guid.NewGuid();
        var receivable = Guid.NewGuid();
        var payable = Guid.NewGuid();
        var revenue = Guid.NewGuid();
        var expense = Guid.NewGuid();
        var deposits = Guid.NewGuid();
        var customer = Guid.NewGuid();
        var vendor = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = customer, CompanyId = company.Id, Name = "Market Viva Ferizaj", TaxNumber = "810000001", FiscalNumber = "810000001", IsCustomer = true });
        db.Partners.Add(new Partner { Id = vendor, CompanyId = company.Id, Name = "Furnitori X", IsVendor = true });
        db.Accounts.AddRange(
            new Account { Id = bank, CompanyId = company.Id, Code = "1100", Name = "Raiffeisen", AccountType = AccountType.Cash, AccountSubType = AccountSubType.Bank },
            new Account { Id = receivable, CompanyId = company.Id, Code = "1200", Name = "Receivable", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable },
            new Account { Id = payable, CompanyId = company.Id, Code = "2000", Name = "Payable", AccountType = AccountType.Payable, AccountSubType = AccountSubType.Payable },
            new Account { Id = revenue, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income },
            new Account { Id = expense, CompanyId = company.Id, Code = "6000", Name = "Expenses", AccountType = AccountType.Expense },
            new Account { Id = deposits, CompanyId = company.Id, Code = "2500", Name = "Deposits", AccountType = AccountType.CurrentLiability });
        db.Journals.AddRange(
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Sale, Code = "SAL", Name = "Sales", SequencePrefix = "SAL", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Purchase, Code = "PUR", Name = "Purchases", SequencePrefix = "PUR", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Cash, Code = "CSH", Name = "Cash", SequencePrefix = "CSH", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank", SequencePrefix = "BNK", SequenceNextNumber = 1, SequencePadding = 4 });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, ReceivableAccountId = receivable, PayableAccountId = payable,
            RevenueAccountId = revenue, ExpenseAccountId = expense, CustomerDepositsAccountId = deposits,
        });
        await db.SaveChangesAsync();
        return new Seed(db, company.Id, bank, customer, vendor, Guid.NewGuid());
    }

    private static ControllerContext Context(Guid userId) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "TestAuth")),
        },
    };

    private static InvoicesController Invoices(Seed s) =>
        new(s.Db, TaxService, new DocumentNumberService(), new NumberSeriesService(s.Db), new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted())
        { ControllerContext = Context(s.UserId) };

    private static BillsController Bills(Seed s) =>
        new(s.Db, TaxService, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted())
        { ControllerContext = Context(s.UserId) };

    private static BankStatementService Service(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted());

    private static ExportLabels Labels() => new(new NullStringLocalizer<ErrorMessages>());

    private static async Task<(Guid Id, string Number)> PostedInvoiceAsync(Seed s, decimal amount)
    {
        var controller = Invoices(s);
        var request = new CreateInvoiceRequest(s.CustomerId, IssueDate, IssueDate.AddDays(30),
            [new CreateInvoiceLineRequest("Goods", 1m, amount, null, null)]);
        var created = (InvoiceResponse)((ObjectResult)(await controller.Create(s.CompanyId, request)).Result!).Value!;
        var posted = (InvoiceResponse)((OkObjectResult)(await controller.Post(s.CompanyId, created.Id)).Result!).Value!;
        return (posted.Id, posted.InvoiceNumber!);
    }

    private static async Task<Guid> PostedBillAsync(Seed s, decimal amount, string vendorReference)
    {
        var controller = Bills(s);
        var request = new CreateBillRequest(s.VendorId, vendorReference, IssueDate, IssueDate.AddDays(30),
            [new CreateBillLineRequest("Stock", 1m, amount, null, null)]);
        var created = (BillResponse)((ObjectResult)(await controller.Create(s.CompanyId, request)).Result!).Value!;
        Assert.IsType<OkObjectResult>((await controller.Post(s.CompanyId, created.Id)).Result);
        return created.Id;
    }

    private static async Task<decimal> InvoiceOutstandingAsync(Seed s, Guid id) =>
        ((DocumentBalanceResponse)((OkObjectResult)(await Invoices(s).Balance(s.CompanyId, id)).Result!).Value!).Outstanding;

    private static async Task<decimal> BillOutstandingAsync(Seed s, Guid id) =>
        ((DocumentBalanceResponse)((OkObjectResult)(await Bills(s).Balance(s.CompanyId, id)).Result!).Value!).Outstanding;

    private sealed record Row(object? Date, string Description, string? Partner, string? Reference, object? In, object? Out);

    // The template as a user would fill it in: downloaded for the account, then typed into.
    private static byte[] FilledTemplate(Guid accountId, decimal opening, decimal closing, IEnumerable<Row> rows,
        DateOnly? from = null, DateOnly? to = null)
    {
        var template = BankStatementWorkbook.Build(new BankStatementTemplateInfo(accountId, "1100 Raiffeisen", null, opening), Labels());
        using var workbook = new XLWorkbook(new MemoryStream(template));
        var sheet = workbook.Worksheet(1);
        if (from is { } f) sheet.Cell(5, 2).Value = f.ToDateTime(TimeOnly.MinValue);
        if (to is { } t) sheet.Cell(6, 2).Value = t.ToDateTime(TimeOnly.MinValue);
        sheet.Cell(7, 2).Value = opening;
        sheet.Cell(8, 2).Value = closing;
        var r = 11;
        foreach (var row in rows)
        {
            Set(sheet.Cell(r, 1), row.Date);
            sheet.Cell(r, 2).Value = row.Description;
            Set(sheet.Cell(r, 3), row.Partner);
            Set(sheet.Cell(r, 4), row.Reference);
            Set(sheet.Cell(r, 5), row.In);
            Set(sheet.Cell(r, 6), row.Out);
            r++;
        }

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();

        static void Set(IXLCell cell, object? value)
        {
            switch (value)
            {
                case null: break;
                case DateOnly d: cell.Value = d.ToDateTime(TimeOnly.MinValue); break;
                case decimal m: cell.Value = m; break;
                default: cell.Value = value.ToString(); break;
            }
        }
    }

    private static async Task<BankStatementDetailResponse> ImportOkAsync(Seed s, byte[] file, string name = "nov.xlsx")
    {
        var (statement, errors) = await Service(s.Db).ImportAsync(s.CompanyId, s.BankAccountId, name, file, s.UserId);
        Assert.Empty(errors);
        return statement!;
    }

    [Fact]
    public async Task Template_CarriesMarkerAccountLedgerOpeningAndHeaders()
    {
        var s = await SeedAsync();
        var result = await Service(s.Db).TemplateAsync(s.CompanyId, s.BankAccountId, Labels());

        using var workbook = new XLWorkbook(new MemoryStream(result.Value!));
        var sheet = workbook.Worksheet(1);
        Assert.Equal(BankStatementWorkbook.Marker, sheet.Cell(1, 8).GetString());
        Assert.Equal(s.BankAccountId.ToString(), sheet.Cell(2, 8).GetString());
        Assert.Equal("1100 Raiffeisen", sheet.Cell(3, 2).GetString());
        Assert.Equal(0m, (decimal)sheet.Cell(7, 2).GetDouble());
        Assert.Equal(["Date", "Description", "Partner (name or fiscal no.)", "Reference (invoice/bill no.)", "Money in", "Money out"],
            Enumerable.Range(1, 6).Select(c => sheet.Cell(10, c).GetString()));
        Assert.Equal(2, workbook.Worksheets.Count);
    }

    [Fact]
    public async Task Template_RefusesAnAccountThatIsNotABankAccount()
    {
        var s = await SeedAsync();
        var receivable = await s.Db.Accounts.Where(a => a.CompanyId == s.CompanyId && a.Code == "1200").Select(a => a.Id).SingleAsync();
        var result = await Service(s.Db).TemplateAsync(s.CompanyId, receivable, Labels());
        Assert.Equal("Choose a bank account.", result.Error);
    }

    [Theory]
    [InlineData("1.234,56", 1234.56)]
    [InlineData("1,234.56", 1234.56)]
    [InlineData("1234,56", 1234.56)]
    [InlineData("1234.56", 1234.56)]
    [InlineData("1 234,50 €", 1234.50)]
    [InlineData("1.234.567", 1234567)]
    [InlineData("830,64 EUR", 830.64)]
    [InlineData("", 0)]
    public void ParseAmount_AcceptsCommonWritings(string text, double expected) =>
        Assert.Equal((decimal)expected, BankStatementWorkbook.ParseAmount(text));

    [Theory]
    [InlineData("03.11.2026")]
    [InlineData("3.11.2026")]
    [InlineData("2026-11-03")]
    [InlineData("03/11/2026")]
    [InlineData("03.11.2026.")]
    public void ParseDate_AcceptsCommonWritings(string text) =>
        Assert.Equal(new DateOnly(2026, 11, 3), BankStatementWorkbook.ParseDate(text));

    [Fact]
    public async Task Import_ReportsEveryBadRowAndSavesNothing()
    {
        var s = await SeedAsync();
        var file = FilledTemplate(s.BankAccountId, 0m, 100m,
        [
            new Row("31.02.2026", "Bad date", null, null, 10m, null),
            new Row(new DateOnly(2026, 11, 3), "Both", null, null, 10m, 5m),
            new Row(new DateOnly(2026, 11, 3), "None", null, null, null, null),
            new Row(new DateOnly(2026, 11, 3), "Text amount", null, null, "abc", null),
            new Row(new DateOnly(2026, 11, 3), "Good", null, null, 100m, null),
        ]);

        var (statement, errors) = await Service(s.Db).ImportAsync(s.CompanyId, s.BankAccountId, "bad.xlsx", file, s.UserId);

        Assert.Null(statement);
        Assert.Equal([11, 12, 13, 14], errors.Select(e => e.Row));
        Assert.Contains("dd.mm.yyyy", errors[0].Message);
        Assert.Equal("Fill in Money in or Money out, not both.", errors[1].Message);
        Assert.False(await s.Db.BankStatements.AnyAsync());
    }

    [Fact]
    public async Task Import_RefusesAFileThatIsNotTheTemplate()
    {
        var s = await SeedAsync();
        var other = ExcelExportService.BuildWorkbook("Sheet", ["Date", "Amount"], [["03.11.2026", 10m]]);
        var (_, errors) = await Service(s.Db).ImportAsync(s.CompanyId, s.BankAccountId, "x.xlsx", other, s.UserId);
        Assert.Equal(0, Assert.Single(errors).Row);

        var (_, notExcel) = await Service(s.Db).ImportAsync(s.CompanyId, s.BankAccountId, "x.xlsx", "not a workbook"u8.ToArray(), s.UserId);
        Assert.Equal("The file is not an Excel (.xlsx) file.", Assert.Single(notExcel).Message);
    }

    [Fact]
    public async Task Import_RefusesATemplateDownloadedForAnotherAccount()
    {
        var s = await SeedAsync();
        var file = FilledTemplate(Guid.NewGuid(), 0m, 10m, [new Row(new DateOnly(2026, 11, 3), "x", null, null, 10m, null)]);
        var (_, errors) = await Service(s.Db).ImportAsync(s.CompanyId, s.BankAccountId, "x.xlsx", file, s.UserId);
        Assert.Equal("This template was downloaded for another bank account.", Assert.Single(errors).Message);
    }

    // The main flow: an invoice found by its number, a bill by partner + exact amount, an unknown line.
    // Confirm records two payments (the invoice and bill balances drop to zero) and leaves the third open.
    // Client request 2026-11-24: the list ribbon filters by period, state and account; the totals
    // under the list are the stored statement totals of what it shows.
    [Fact]
    public async Task List_FiltersByOverlappingPeriodAndState_AndTotalsMatch()
    {
        var s = await SeedAsync();
        await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 500m, 600m,
            [new Row(new DateOnly(2026, 10, 3), "Arketim", null, null, 100m, null)], new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31)), "oct.xlsx");
        await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 600m, 570m,
            [new Row(new DateOnly(2026, 11, 3), "Komision", null, null, null, 30m)], new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30)), "nov.xlsx");
        var service = Service(s.Db);

        var november = new BankStatementService.ListFilter(From: new DateOnly(2026, 11, 15), To: new DateOnly(2026, 12, 31));
        Assert.Equal(["nov.xlsx"], (await service.ListAsync(s.CompanyId, november)).Select(x => x.FileName));
        Assert.Equal(new BankStatementListTotalsResponse(1, 0m, 30m), await service.TotalsAsync(s.CompanyId, november));

        Assert.Equal(new BankStatementListTotalsResponse(2, 100m, 30m), await service.TotalsAsync(s.CompanyId));
        Assert.Empty(await service.ListAsync(s.CompanyId, new BankStatementService.ListFilter(State: BankStatementState.Confirmed)));
        Assert.Empty(await service.ListAsync(s.CompanyId, new BankStatementService.ListFilter(BankAccountId: Guid.NewGuid())));
    }

    [Fact]
    public async Task ImportAndConfirm_PaysTheMatchedInvoiceAndBill_LeavesTheRestOpen()
    {
        var s = await SeedAsync();
        var (invoiceId, invoiceNumber) = await PostedInvoiceAsync(s, 830.64m);
        var billId = await PostedBillAsync(s, 1200m, "F-118");
        var file = FilledTemplate(s.BankAccountId, 500m, 500m + 830.64m - 1200m - 2.5m,
        [
            new Row(new DateOnly(2026, 11, 3), "Pagese", "Market Viva", $"Pagesa fat. {invoiceNumber}", 830.64m, null),
            new Row(new DateOnly(2026, 11, 5), "Pagese furnitori", "Furnitori X", null, null, 1200m),
            new Row(new DateOnly(2026, 11, 6), "Komision bankar", null, null, null, 2.5m),
        ], new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30));

        var preview = await ImportOkAsync(s, file);

        Assert.Equal(["Ready", "Ready", "None"], preview.Lines.Select(l => l.MatchStatus));
        Assert.Equal(invoiceId, preview.Lines[0].InvoiceId);
        Assert.Equal(830.64m, preview.Lines[0].DocumentOutstanding);
        Assert.Equal(billId, preview.Lines[1].BillId);
        Assert.Equal(0m, preview.BalanceDifference);
        Assert.Equal("Draft", preview.Summary.State);
        Assert.Equal(830.64m, await InvoiceOutstandingAsync(s, invoiceId));

        var confirmed = await Service(s.Db).ConfirmAsync(s.CompanyId, preview.Summary.Id, s.UserId);

        Assert.Null(confirmed.Error);
        Assert.Equal("Confirmed", confirmed.Value!.Summary.State);
        Assert.Equal(["Matched", "Matched", "None"], confirmed.Value.Lines.Select(l => l.MatchStatus));
        Assert.Equal(0m, await InvoiceOutstandingAsync(s, invoiceId));
        Assert.Equal(0m, await BillOutstandingAsync(s, billId));

        // Posted exactly like "Record payment": Bank journal, bank against AR/AP, reconciled.
        var bankJournal = await s.Db.Journals.SingleAsync(j => j.CompanyId == s.CompanyId && j.Type == JournalType.Bank);
        var entries = await s.Db.JournalEntries.Include(e => e.Lines)
            .Where(e => e.JournalId == bankJournal.Id).ToListAsync();
        Assert.Equal(2, entries.Count);
        Assert.All(entries, e => Assert.Equal(JournalEntryState.Posted, e.State));
        Assert.Equal(830.64m, entries.Single(e => e.Date == new DateOnly(2026, 11, 3)).Lines.Single(l => l.AccountId == s.BankAccountId).Debit);
        Assert.Equal(1200m, entries.Single(e => e.Date == new DateOnly(2026, 11, 5)).Lines.Single(l => l.AccountId == s.BankAccountId).Credit);
        Assert.Equal(2, await s.Db.Reconciliations.CountAsync(r => r.CompanyId == s.CompanyId));
        Assert.True(await s.Db.AuditEntries.AnyAsync(a => a.CompanyId == s.CompanyId && a.EntityType == "BankStatement" && a.Action == "Confirm"));

        // The open line is not posted anywhere: nothing on any other account.
        Assert.Null(confirmed.Value.Lines[2].JournalEntryId);
        Assert.Equal("Open", confirmed.Value.Lines[2].State);
    }

    [Fact]
    public async Task Import_FindsThePartnerByFiscalNumber_AndOffersAChoiceWhenAmountsDiffer()
    {
        var s = await SeedAsync();
        await PostedInvoiceAsync(s, 100m);
        await PostedInvoiceAsync(s, 200m);
        var file = FilledTemplate(s.BankAccountId, 0m, 150m,
            [new Row(new DateOnly(2026, 11, 3), "Pagese", "810000001", null, 150m, null)]);

        var preview = await ImportOkAsync(s, file);

        var line = Assert.Single(preview.Lines);
        Assert.Equal("Choose", line.MatchStatus);
        Assert.Equal(s.CustomerId, line.PartnerId);
        Assert.Equal("Market Viva Ferizaj", line.PartnerName);

        var candidates = (await Service(s.Db).CandidatesAsync(s.CompanyId, preview.Summary.Id, line.Id, null)).Value!;
        Assert.Equal([200m, 100m], candidates.Select(c => c.Outstanding).OrderByDescending(x => x));
        Assert.All(candidates, c => Assert.Equal("Invoice", c.Kind));
    }

    // Choosing a document by hand, a partial payment, and the open amount the screen shows afterwards
    // equals the invoice's own balance endpoint.
    [Fact]
    public async Task UpdateLine_ChoosesAPartialPayment_AndConfirmLeavesTheRestOpenOnTheInvoice()
    {
        var s = await SeedAsync();
        var (invoiceId, _) = await PostedInvoiceAsync(s, 500m);
        var preview = await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 0m, 200m,
            [new Row(new DateOnly(2026, 11, 3), "Pagese e pjesshme", null, null, 200m, null)]));
        var lineId = preview.Lines.Single().Id;
        var service = Service(s.Db);

        var tooHigh = await service.UpdateLineAsync(s.CompanyId, preview.Summary.Id, lineId, new UpdateBankStatementLineRequest(InvoiceId: invoiceId, Amount: 250m));
        Assert.NotNull(tooHigh.Error);

        var updated = await service.UpdateLineAsync(s.CompanyId, preview.Summary.Id, lineId, new UpdateBankStatementLineRequest(InvoiceId: invoiceId));
        Assert.Equal(200m, updated.Value!.Lines.Single().MatchAmount);
        Assert.Equal("Ready", updated.Value.Lines.Single().MatchStatus);

        await service.ConfirmAsync(s.CompanyId, preview.Summary.Id, s.UserId);

        Assert.Equal(300m, await InvoiceOutstandingAsync(s, invoiceId));
        var again = await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 200m, 300m,
            [new Row(new DateOnly(2026, 11, 9), "Pjesa tjeter", null, null, 100m, null)]), "second.xlsx");
        var candidate = Assert.Single((await service.CandidatesAsync(s.CompanyId, again.Summary.Id, again.Lines.Single().Id, null)).Value!);
        Assert.Equal(300m, candidate.Outstanding);
    }

    [Fact]
    public async Task UpdateLine_RefusesABillForMoneyIn_AndCanIgnoreALine()
    {
        var s = await SeedAsync();
        var billId = await PostedBillAsync(s, 50m, "F-1");
        var preview = await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 0m, 50m,
            [new Row(new DateOnly(2026, 11, 3), "Hyrje", null, null, 50m, null)]));
        var lineId = preview.Lines.Single().Id;
        var service = Service(s.Db);

        var wrong = await service.UpdateLineAsync(s.CompanyId, preview.Summary.Id, lineId, new UpdateBankStatementLineRequest(BillId: billId));
        Assert.Equal("Money in pays a customer invoice; money out pays a supplier bill.", wrong.Error);

        var ignored = await service.UpdateLineAsync(s.CompanyId, preview.Summary.Id, lineId, new UpdateBankStatementLineRequest(Ignore: true));
        Assert.Equal("Ignored", ignored.Value!.Lines.Single().MatchStatus);
    }

    [Fact]
    public async Task Confirm_RefusedWhenTheBalancesDoNotAddUp()
    {
        var s = await SeedAsync();
        await PostedInvoiceAsync(s, 100m);
        var preview = await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 0m, 90m,
            [new Row(new DateOnly(2026, 11, 3), "Pagese", "Market Viva Ferizaj", null, 100m, null)]));

        var result = await Service(s.Db).ConfirmAsync(s.CompanyId, preview.Summary.Id, s.UserId);

        Assert.Contains("closing balance", result.Error);
        Assert.Equal(10m, preview.BalanceDifference);
        Assert.False(await s.Db.Reconciliations.AnyAsync(r => r.CompanyId == s.CompanyId));
    }

    // A line dated inside a locked period fails; the whole confirm rolls back, including the lines
    // before it, and the statement stays Draft.
    [Fact]
    public async Task Confirm_RollsEverythingBack_WhenOneLineHitsTheLockDate()
    {
        var s = await SeedAsync();
        var (first, _) = await PostedInvoiceAsync(s, 100m);
        var billId = await PostedBillAsync(s, 40m, "F-9");
        var preview = await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 0m, 60m,
        [
            new Row(new DateOnly(2026, 11, 20), "Pagese", "Market Viva Ferizaj", null, 100m, null),
            new Row(new DateOnly(2026, 11, 3), "Furnitori", "Furnitori X", "F-9", null, 40m),
        ]));
        var company = await s.Db.Companies.SingleAsync(c => c.Id == s.CompanyId);
        company.AccountingLockDate = new DateOnly(2026, 11, 10);
        await s.Db.SaveChangesAsync();

        var result = await Service(s.Db).ConfirmAsync(s.CompanyId, preview.Summary.Id, s.UserId);

        Assert.StartsWith("Row 12:", result.Error);
        Assert.Equal(100m, await InvoiceOutstandingAsync(s, first));
        Assert.Equal(40m, await BillOutstandingAsync(s, billId));
        Assert.False(await s.Db.Reconciliations.AnyAsync(r => r.CompanyId == s.CompanyId));
        var statement = await s.Db.BankStatements.AsNoTracking().SingleAsync();
        Assert.Equal(BankStatementState.Draft, statement.State);
    }

    [Fact]
    public async Task Import_RefusesTheSameFile_AndFlagsALineAlreadyImported()
    {
        var s = await SeedAsync();
        var rows = new List<Row> { new(new DateOnly(2026, 11, 3), "Pagese", null, "X-1", 10m, null) };
        var file = FilledTemplate(s.BankAccountId, 0m, 10m, rows);
        await ImportOkAsync(s, file);

        var (_, same) = await Service(s.Db).ImportAsync(s.CompanyId, s.BankAccountId, "copy.xlsx", file, s.UserId);
        Assert.Equal("This file has already been imported.", Assert.Single(same).Message);

        rows.Add(new Row(new DateOnly(2026, 11, 4), "Tjeter", null, "X-2", 5m, null));
        var overlapping = await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 0m, 15m, rows), "overlap.xlsx");
        Assert.Equal([true, false], overlapping.Lines.Select(l => l.IsDuplicate));
        Assert.Equal(["Ignored", "None"], overlapping.Lines.Select(l => l.MatchStatus));
    }

    [Fact]
    public async Task Import_NeverMatchesAnotherCompanysInvoice()
    {
        var mine = await SeedAsync("Mine");
        var other = await SeedAsync("Other");
        var (_, otherNumber) = await PostedInvoiceAsync(other, 100m);

        var preview = await ImportOkAsync(mine, FilledTemplate(mine.BankAccountId, 0m, 100m,
            [new Row(new DateOnly(2026, 11, 3), "Pagese", null, otherNumber, 100m, null)]));

        Assert.Equal("None", preview.Lines.Single().MatchStatus);
        Assert.Null(preview.Lines.Single().InvoiceId);
    }

    [Fact]
    public async Task PostLine_RecordsALineMatchedAfterConfirmation()
    {
        var s = await SeedAsync();
        var preview = await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 0m, 70m,
            [new Row(new DateOnly(2026, 11, 3), "Pagese pa reference", null, null, 70m, null)]));
        var service = Service(s.Db);
        Assert.Null((await service.ConfirmAsync(s.CompanyId, preview.Summary.Id, s.UserId)).Error);

        var (invoiceId, _) = await PostedInvoiceAsync(s, 70m);
        var lineId = preview.Lines.Single().Id;
        await service.UpdateLineAsync(s.CompanyId, preview.Summary.Id, lineId, new UpdateBankStatementLineRequest(InvoiceId: invoiceId));
        var posted = await service.PostLineAsync(s.CompanyId, preview.Summary.Id, lineId, s.UserId);

        Assert.Equal("Matched", posted.Value!.Lines.Single().MatchStatus);
        Assert.Equal(0m, await InvoiceOutstandingAsync(s, invoiceId));
    }

    [Fact]
    public async Task Delete_OnlyADraft()
    {
        var s = await SeedAsync();
        var preview = await ImportOkAsync(s, FilledTemplate(s.BankAccountId, 0m, 1m,
            [new Row(new DateOnly(2026, 11, 3), "x", null, null, 1m, null)]));
        var service = Service(s.Db);
        Assert.True((await service.DeleteAsync(s.CompanyId, preview.Summary.Id, s.UserId)).Value);
        Assert.False(await s.Db.BankStatementLines.AnyAsync());
    }
}

public class BankStatementMatcherTests
{
    private static readonly Guid Viva = Guid.NewGuid();
    private static readonly Guid Other = Guid.NewGuid();

    private static readonly PartnerKey[] Partners =
    [
        new(Viva, "Market Viva Ferizaj", "810000001", null),
        new(Other, "Market Viva Prishtine", null, null),
    ];

    private static OpenDocument Invoice(string number, decimal open, Guid? partner = null) =>
        new(OpenDocumentKind.Invoice, Guid.NewGuid(), number, partner ?? Viva, new DateOnly(2026, 11, 1), open);

    [Fact]
    public void Reference_ExactOrAsAWholeWord_FindsTheInvoice()
    {
        var doc = Invoice("01/2026", 100m);
        Assert.Same(doc, BankStatementMatcher.FindByReference("01/2026", [doc]));
        Assert.Same(doc, BankStatementMatcher.FindByReference("Pagesa fat. 01/2026 faleminderit", [doc]));
        Assert.Null(BankStatementMatcher.FindByReference("101/20266", [doc]));
    }

    [Fact]
    public void Reference_ShortNumbersAreNotSearchedInsideText()
    {
        var doc = Invoice("12", 100m);
        Assert.Same(doc, BankStatementMatcher.FindByReference("12", [doc]));
        Assert.Null(BankStatementMatcher.FindByReference("Pagesa 12 nentor", [doc]));
    }

    [Fact]
    public void Partner_ByNumberThenExactNameThenUniqueContains()
    {
        Assert.Equal(Viva, BankStatementMatcher.ResolvePartner("810000001", Partners)!.Id);
        Assert.Equal(Viva, BankStatementMatcher.ResolvePartner("market viva ferizaj", Partners)!.Id);
        Assert.Equal(Other, BankStatementMatcher.ResolvePartner("Prishtine", Partners)!.Id);
        Assert.Null(BankStatementMatcher.ResolvePartner("Market Viva", Partners));
    }

    [Fact]
    public void TwoLinesOnOneInvoice_NeverApplyMoreThanIsOpen()
    {
        var doc = Invoice("01/2026", 100m);
        var suggestions = BankStatementMatcher.Suggest(
        [
            new StatementLineInput(true, 70m, "01/2026", null),
            new StatementLineInput(true, 70m, "01/2026", null),
            new StatementLineInput(true, 70m, "01/2026", null),
        ], [doc], Partners);

        Assert.Equal([70m, 30m], suggestions.Take(2).Select(m => m.Amount));
        Assert.Equal(MatchStatus.None, suggestions[2].Status);
    }

    [Fact]
    public void PartnerAndExactAmount_Matches_OtherwiseChoose()
    {
        var a = Invoice("A-1", 100m);
        var b = Invoice("A-2", 250m);
        var suggestions = BankStatementMatcher.Suggest(
        [
            new StatementLineInput(true, 250m, null, "Market Viva Ferizaj"),
            new StatementLineInput(true, 90m, null, "Market Viva Ferizaj"),
            new StatementLineInput(true, 90m, null, "Unknown"),
        ], [a, b], Partners);

        Assert.Same(b, suggestions[0].Document);
        Assert.Equal(MatchStatus.Choose, suggestions[1].Status);
        Assert.Equal(Viva, suggestions[1].PartnerId);
        Assert.Equal(MatchStatus.None, suggestions[2].Status);
    }

    [Fact]
    public void MoneyOut_OnlyMatchesBills()
    {
        var invoice = Invoice("X-1", 50m);
        var bill = new OpenDocument(OpenDocumentKind.Bill, Guid.NewGuid(), "X-1", Viva, new DateOnly(2026, 11, 1), 50m);
        var suggestion = BankStatementMatcher.Suggest([new StatementLineInput(false, 50m, "X-1", null)], [invoice, bill], Partners).Single();
        Assert.Same(bill, suggestion.Document);
    }
}
