using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public record ReportSource(string Kind, Guid Id);

public class ReportSourceResolver(PakoDbContext db)
{
    public async Task<Dictionary<Guid, ReportSource>> ResolveEntriesAsync(Guid companyId, IEnumerable<Guid> entryIds)
    {
        var ids = entryIds.Distinct().ToList();
        var result = new Dictionary<Guid, ReportSource>();
        if (ids.Count == 0)
        {
            return result;
        }

        var entries = await db.JournalEntries.AsNoTracking()
            .Where(e => e.CompanyId == companyId && ids.Contains(e.Id))
            .Select(e => new { e.Id, e.SourceDocumentId })
            .ToListAsync();

        var sourceIds = entries.Where(e => e.SourceDocumentId != null).Select(e => e.SourceDocumentId!.Value).Distinct().ToList();
        var kinds = new Dictionary<Guid, string>();
        if (sourceIds.Count > 0)
        {
            foreach (var i in await db.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && sourceIds.Contains(i.Id))
                .Select(i => new { i.Id, i.DocumentType }).ToListAsync())
            {
                kinds[i.Id] = ReportSourceKinds.ForInvoice(i.DocumentType);
            }

            foreach (var b in await db.Bills.AsNoTracking()
                .Where(b => b.CompanyId == companyId && sourceIds.Contains(b.Id))
                .Select(b => new { b.Id, b.DocumentType }).ToListAsync())
            {
                kinds[b.Id] = ReportSourceKinds.ForBill(b.DocumentType);
            }

            foreach (var id in await db.PayrollRuns.AsNoTracking()
                .Where(p => p.CompanyId == companyId && sourceIds.Contains(p.Id))
                .Select(p => p.Id).ToListAsync())
            {
                kinds[id] = ReportSourceKinds.PayrollRun;
            }

            foreach (var id in await db.StockDocuments.AsNoTracking()
                .Where(s => s.CompanyId == companyId && sourceIds.Contains(s.Id))
                .Select(s => s.Id).ToListAsync())
            {
                kinds[id] = ReportSourceKinds.StockDocument;
            }
        }

        foreach (var e in entries)
        {
            result[e.Id] = e.SourceDocumentId is { } sid && kinds.TryGetValue(sid, out var kind)
                ? new ReportSource(kind, sid)
                : new ReportSource(ReportSourceKinds.JournalEntry, e.Id);
        }

        return result;
    }
}
