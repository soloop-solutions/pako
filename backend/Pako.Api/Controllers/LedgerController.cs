using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
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
            .Select(s =>
            {
                var account = accounts[s.AccountId];
                return new TrialBalanceLine(s.AccountId, account.Code, account.Name, s.Debit, s.Credit, s.Debit - s.Credit);
            })
            .OrderBy(l => l.AccountCode)
            .ToList();

        return Ok(result);
    }
}
