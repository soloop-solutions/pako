using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// B4: shared by every controller that posts a document (Invoices/Bills/JournalEntries/PayrollRuns)
// so each one computes the SAME per-user effective lock dates before calling the domain Post()
// method, rather than four separate copies of the same exception-lookup + resolve steps. Static,
// same pattern as ReconciliationCreator — no state beyond the PakoDbContext each call already has.
public static class AccountLockService
{
    public static async Task<Company> GetEffectiveCompanyAsync(PakoDbContext db, Company company, Guid userId)
    {
        var now = DateTime.UtcNow;
        var liveExceptions = await db.AccountLockExceptions.AsNoTracking()
            .Where(e => e.CompanyId == company.Id && e.UserId == userId && e.RevokedAt == null && e.EndsAt > now)
            .ToListAsync();

        return AccountLockResolver.ApplyEffectiveLocks(company, userId, liveExceptions);
    }
}
