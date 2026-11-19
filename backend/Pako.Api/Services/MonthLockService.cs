using Microsoft.EntityFrameworkCore;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// Checks whether a transaction date falls in a locked month. Called by controllers before
// posting, alongside the existing AccountLockService soft/hard lock checks.
public static class MonthLockService
{
    public static async Task EnsureMonthOpenAsync(PakoDbContext db, Guid companyId, DateOnly date)
    {
        var isLocked = await db.MonthLocks.AsNoTracking()
            .AnyAsync(m => m.CompanyId == companyId && m.Year == date.Year && m.Month == date.Month && m.IsLocked);

        if (isLocked)
            throw new MonthLockViolationException(date.Year, date.Month);
    }
}
