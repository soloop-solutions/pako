using Pako.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

// Trial balance rows sort by Account.CreatedAt (insertion order), not by Code — confirmed
// directly by seeding accounts with codes deliberately out of creation order.
public class LedgerControllerTests
{
    [Fact]
    public async Task TrialBalance_OrdersByAccountCreatedAt_NotByCode()
    {
        await using var db = await PostgresTestDatabase.CreateAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };

        // Code order would be 1000 < 2000 < 3000; creation order is deliberately the reverse.
        var accountA = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "3000", Name = "Third", AccountType = AccountType.Equity, CreatedAt = DateTime.UtcNow.AddMinutes(-3) };
        var accountB = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "2000", Name = "Second", AccountType = AccountType.CurrentLiability, CreatedAt = DateTime.UtcNow.AddMinutes(-2) };
        var accountC = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "First", AccountType = AccountType.CurrentAsset, CreatedAt = DateTime.UtcNow.AddMinutes(-1) };

        db.Companies.Add(company);
        db.Journals.Add(journal);
        db.Accounts.AddRange(accountA, accountB, accountC);

        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = journal.Id,
            Date = new DateOnly(2026, 9, 1),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountA.Id, Debit = 0m, Credit = 100m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountB.Id, Debit = 0m, Credit = 100m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountC.Id, Debit = 200m, Credit = 0m }
            }
        };
        entry.Post(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var controller = new LedgerController(db, new NullStringLocalizer<ErrorMessages>(), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));

        var result = await controller.TrialBalance(company.Id);

        var lines = Assert.IsType<List<TrialBalanceLine>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new[] { "3000", "2000", "1000" }, lines.Select(l => l.AccountCode));
    }

    // B11: the export wrapper is a thin pass-through over TrialBalance's own JSON data — this
    // proves the file it hands back is actually a valid, readable workbook containing those rows.
    [Fact]
    public async Task TrialBalanceExport_ReturnsXlsxWithMatchingRows()
    {
        await using var db = await PostgresTestDatabase.CreateAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        var accountA = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.CurrentAsset };
        var accountB = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "3000", Name = "Capital", AccountType = AccountType.Equity };

        db.Companies.Add(company);
        db.Journals.Add(journal);
        db.Accounts.AddRange(accountA, accountB);

        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = journal.Id,
            Date = new DateOnly(2026, 9, 1),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountA.Id, Debit = 100m, Credit = 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = accountB.Id, Debit = 0m, Credit = 100m }
            }
        };
        entry.Post(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var controller = new LedgerController(db, new NullStringLocalizer<ErrorMessages>(), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));

        var result = await controller.TrialBalanceExport(company.Id);

        var fileResult = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileResult.ContentType);
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(fileResult.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Account Code", sheet.Cell(1, 1).GetString());
        Assert.Equal("1000", sheet.Cell(2, 1).GetString());
        Assert.Equal("Opening", sheet.Cell(1, 3).GetString());
        Assert.Equal(100m, sheet.Cell(2, 4).GetValue<decimal>());
    }

    private static async Task<(PakoDbContext Db, Guid CompanyId, LedgerController Controller)> SeedPeriodAsync(bool withEntries = true)
    {
        var db = await PostgresTestDatabase.CreateAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Period Co" };
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        var cash = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "100100", Name = "Cash", AccountType = AccountType.Cash, Class = 1 };
        var revenue = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "400100", Name = "Sales", AccountType = AccountType.Income, Class = 4 };
        var classGroup = new AccountGroup { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Assets", CodePrefixStart = "100000", CodePrefixEnd = "199999" };
        var group = new AccountGroup { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Cash and equivalents", CodePrefixStart = "100000", CodePrefixEnd = "109999", ParentGroupId = classGroup.Id };
        db.Companies.Add(company);
        db.Journals.Add(journal);
        db.Accounts.AddRange(cash, revenue);
        db.AccountGroups.AddRange(classGroup, group);
        if (withEntries)
        {
            foreach (var (date, amount) in new[] { (new DateOnly(2026, 1, 31), 100m), (new DateOnly(2026, 2, 1), 40m), (new DateOnly(2026, 2, 28), 10m), (new DateOnly(2026, 3, 1), 7m) })
            {
                var entry = new JournalEntry
                {
                    Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = journal.Id, Date = date,
                    Lines =
                    {
                        new JournalEntryLine { Id = Guid.NewGuid(), AccountId = cash.Id, Debit = amount },
                        new JournalEntryLine { Id = Guid.NewGuid(), AccountId = revenue.Id, Credit = amount }
                    }
                };
                entry.Post(company);
                db.JournalEntries.Add(entry);
            }
        }
        await db.SaveChangesAsync();
        return (db, company.Id, new LedgerController(db, new NullStringLocalizer<ErrorMessages>(), new ExportLabels(new NullStringLocalizer<ErrorMessages>())));
    }

    [Fact]
    public async Task TrialBalance_NoPeriod_KeepsOldMeaning_OpeningZero()
    {
        var (db, companyId, controller) = await SeedPeriodAsync();
        await using var _ = db;
        var lines = Assert.IsType<List<TrialBalanceLine>>(Assert.IsType<OkObjectResult>((await controller.TrialBalance(companyId)).Result).Value);

        var cash = lines.Single(l => l.AccountCode == "100100");
        Assert.Equal(0m, cash.Opening);
        Assert.Equal(157m, cash.Debit);
        Assert.Equal(0m, cash.Credit);
        Assert.Equal(157m, cash.Balance);
        Assert.Equal(157m, cash.Closing);
        Assert.Equal(1, cash.Class);
        Assert.Equal("Cash and equivalents", cash.GroupName);
        Assert.Null(lines.Single(l => l.AccountCode == "400100").GroupName);
    }

    [Fact]
    public async Task TrialBalance_Period_SplitsOpeningMovementClosing_EntryOnFromIsMovement()
    {
        var (db, companyId, controller) = await SeedPeriodAsync();
        await using var _ = db;
        var lines = Assert.IsType<List<TrialBalanceLine>>(Assert.IsType<OkObjectResult>(
            (await controller.TrialBalance(companyId, new DateOnly(2026, 2, 1), new DateOnly(2026, 2, 28))).Result).Value);

        var cash = lines.Single(l => l.AccountCode == "100100");
        Assert.Equal(100m, cash.Opening);
        Assert.Equal(50m, cash.Debit);
        Assert.Equal(0m, cash.Credit);
        Assert.Equal(150m, cash.Closing);
        var sales = lines.Single(l => l.AccountCode == "400100");
        Assert.Equal(-100m, sales.Opening);
        Assert.Equal(50m, sales.Credit);
        Assert.Equal(-150m, sales.Closing);
        Assert.Equal(0m, lines.Sum(l => l.Closing));
    }

    [Fact]
    public async Task TrialBalance_EmptyCompany_ReturnsNoRows()
    {
        var (db, companyId, controller) = await SeedPeriodAsync(withEntries: false);
        await using var _ = db;
        var lines = Assert.IsType<List<TrialBalanceLine>>(Assert.IsType<OkObjectResult>(
            (await controller.TrialBalance(companyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31))).Result).Value);
        Assert.Empty(lines);
    }

    [Fact]
    public async Task TrialBalance_FromAfterTo_Returns400_ReportDateRangeInvalid()
    {
        var (db, companyId, controller) = await SeedPeriodAsync();
        await using var _ = db;
        var bad = Assert.IsType<BadRequestObjectResult>((await controller.TrialBalance(companyId, new DateOnly(2026, 3, 1), new DateOnly(2026, 2, 1))).Result);
        Assert.Contains("start date cannot be after the end date", bad.Value!.ToString());
    }

    [Fact]
    public async Task TrialBalanceExport_HasOpeningDebitCreditClosingAndTotalRow()
    {
        var (db, companyId, controller) = await SeedPeriodAsync();
        await using var _ = db;
        var file = Assert.IsType<FileContentResult>(await controller.TrialBalanceExport(companyId, new DateOnly(2026, 2, 1), new DateOnly(2026, 2, 28)));
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal(new[] { "Account Code", "Account Name", "Opening", "Debit", "Credit", "Closing" }, Enumerable.Range(1, 6).Select(c => sheet.Cell(1, c).GetString()));
        Assert.Equal("Total", sheet.Cell(4, 1).GetString());
        Assert.Equal(0m, sheet.Cell(4, 3).GetValue<decimal>());
        Assert.Equal(50m, sheet.Cell(4, 4).GetValue<decimal>());
        Assert.Equal(50m, sheet.Cell(4, 5).GetValue<decimal>());
        Assert.Equal(0m, sheet.Cell(4, 6).GetValue<decimal>());
    }
}
