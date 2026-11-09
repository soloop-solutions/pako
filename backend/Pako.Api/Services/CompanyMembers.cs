using Microsoft.EntityFrameworkCore;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public static class CompanyMembers
{
    public static Task<bool> ExistsAsync(PakoDbContext db, Guid companyId, Guid userId) =>
        db.Memberships.AsNoTracking().AnyAsync(m => m.UserId == userId && m.IsActive &&
            (m.CompanyId == companyId || (m.FirmId != null && db.Companies.Any(c => c.Id == companyId && c.FirmId == m.FirmId))));
}
