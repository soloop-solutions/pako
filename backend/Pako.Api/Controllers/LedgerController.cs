using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/ledger")]
[Authorize]
public class LedgerController : ControllerBase
{
    private readonly PakoDbContext _db;

    public LedgerController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet("trial-balance")]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<TrialBalanceLine>>> TrialBalance(Guid companyId)
    {
        var sums = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId && l.JournalEntry.State == JournalEntryState.Posted)
            .GroupBy(l => l.AccountId)
            .Select(g => new { AccountId = g.Key, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
            .ToListAsync();

        var accountIds = sums.Select(s => s.AccountId).ToList();
        var accounts = await _db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id);

        var result = sums
            .Select(s => (Account: accounts[s.AccountId], s.Debit, s.Credit))
            .OrderBy(s => s.Account.CreatedAt)
            .Select(s => new TrialBalanceLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Debit, s.Credit, s.Debit - s.Credit))
            .ToList();

        return Ok(result);
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("trial-balance/export", Name = "TrialBalanceExport")]
    [RequireCompanyAccess]
    public async Task<IActionResult> TrialBalanceExport(Guid companyId)
    {
        var result = await TrialBalance(companyId);
        if (result.Result is not OkObjectResult ok || ok.Value is not List<TrialBalanceLine> lines)
        {
            return result.Result!;
        }

        var headers = new[] { "Account Code", "Account Name", "Debit", "Credit", "Balance" };
        var rows = lines.Select(l => (IReadOnlyList<object?>)new object?[] { l.AccountCode, l.AccountName, l.Debit, l.Credit, l.Balance }).ToList();

        var bytes = ExcelExportService.BuildWorkbook("Trial Balance", headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, "trial-balance.xlsx");
    }
}
