using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Infrastructure;

namespace Pako.Api.Services;

/// <summary>
/// B5: derives the next number from the highest existing number matching the series' pattern —
/// never a stored counter. A counter drifts from reality after a manual override
/// (NumberSeriesController.OverrideInvoiceNumber) or a discarded-and-reissued draft; max(existing)
/// cannot. Concurrent posts for the same company are already serialized by the company-row
/// FOR UPDATE lock InvoicesController.Post takes before calling here — this class additionally
/// takes its own FOR UPDATE lock on the series config row (unchanged from before B5) so callers
/// that don't lock the company row first (ItemsController.Create, the Proforma branch of
/// InvoicesController.Create) still get the same per-series serialization the old counter design
/// relied on, even though the row's own content no longer changes.
/// </summary>
public class NumberSeriesService
{
    private readonly PakoDbContext _db;

    public NumberSeriesService(PakoDbContext db) => _db = db;

    /// <summary>
    /// Reserves the next number for the given company, document type, and year. "Reserve" here
    /// means "compute, under a serializing lock" — nothing is persisted by this call itself; the
    /// number becomes real only once the caller saves the document that carries it.
    /// </summary>
    public async Task<string> ReserveNextAsync(Guid companyId, string documentType, int year)
    {
        NumberSeries series;

        if (_db.Database.SupportsRowLocking())
        {
            series = await EnsureSeriesExistsPostgresAsync(companyId, documentType, year);
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT \"Id\" FROM number_series WHERE \"Id\" = {series.Id} FOR UPDATE");
        }
        else
        {
            series = await GetOrCreateSeriesAsync(companyId, documentType, year);
        }

        var nextSeq = await GetNextSequenceValueAsync(companyId, documentType, year, series.Pattern);
        return FormatNumber(series.Pattern, nextSeq, year);
    }

    /// <summary>
    /// Returns what the next number would be without taking the serializing lock (B2: preview,
    /// clearly provisional — see NumberPreviewResponse.IsProvisional). Identical computation to
    /// ReserveNextAsync since neither one persists anything; this one just skips the lock, since a
    /// preview doesn't need to serialize against anything.
    /// </summary>
    public async Task<string> PreviewNextAsync(Guid companyId, string documentType, int year)
    {
        var series = await _db.NumberSeriesSet.AsNoTracking()
            .FirstOrDefaultAsync(s => s.CompanyId == companyId && s.DocumentType == documentType && s.Year == year);

        var pattern = series?.Pattern ?? DefaultPattern(documentType);
        var nextSeq = await GetNextSequenceValueAsync(companyId, documentType, year, pattern);
        return FormatNumber(pattern, nextSeq, year);
    }

    // B5: the highest sequence value already issued for this (company, document type), plus one.
    // Year-scoped patterns (contain {yyyy}, e.g. Invoice's "{seq:D2}/{yyyy}") only look at
    // documents issued in that same year, so the sequence resets the way the pattern's own display
    // implies. Patterns without {yyyy} (CN-/DN-/DP-/SR-/PRO-, Item's plain "{seq}") look across
    // every year the company has ever issued that type — a year-keyed lookup with a
    // non-year-scoped pattern is exactly how the old NextValue counter design could silently
    // restart a sequence every January and collide with a prior year's identical-looking number;
    // deriving from the true historical max avoids that by construction.
    private async Task<int> GetNextSequenceValueAsync(Guid companyId, string documentType, int year, string pattern)
    {
        var isYearScoped = pattern.Contains("{yyyy}");

        if (documentType == "Item")
        {
            var maxItemCode = await _db.Items.AsNoTracking()
                .Where(i => i.CompanyId == companyId)
                .Select(i => (int?)i.Code)
                .MaxAsync() ?? 0;
            return maxItemCode + 1;
        }

        if (!Enum.TryParse<DocumentType>(documentType, out var docType))
        {
            return 1;
        }

        var query = _db.Invoices.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.DocumentType == docType && i.InvoiceNumber != null);
        if (isYearScoped)
        {
            query = query.Where(i => i.IssueDate.Year == year);
        }

        var issuedNumbers = await query.Select(i => i.InvoiceNumber!).ToListAsync();

        var maxSeq = 0;
        foreach (var number in issuedNumbers)
        {
            if (ExtractSequenceValue(number) is { } seq && seq > maxSeq)
            {
                maxSeq = seq;
            }
        }

        return maxSeq + 1;
    }

    private static int? ExtractSequenceValue(string number)
    {
        var match = Regex.Match(number, @"\d+");
        return match.Success && int.TryParse(match.Value, out var val) ? val : null;
    }

    /// <summary>
    /// Postgres-only: ensures the series config row exists (committed, visible to FOR UPDATE).
    /// Uses a direct SQL UPSERT to avoid triggering EF's change-tracker SaveChangesAsync (which
    /// would fire the immutability validator on any other tracked entities).
    /// </summary>
    private async Task<NumberSeries> EnsureSeriesExistsPostgresAsync(Guid companyId, string documentType, int year)
    {
        var series = await _db.NumberSeriesSet
            .FirstOrDefaultAsync(s => s.CompanyId == companyId && s.DocumentType == documentType && s.Year == year);

        if (series != null) return series;

        var id = Guid.NewGuid();
        var pattern = DefaultPattern(documentType);

        await _db.Database.ExecuteSqlInterpolatedAsync(
            $@"INSERT INTO number_series (""Id"", ""CompanyId"", ""DocumentType"", ""Year"", ""Pattern"")
               VALUES ({id}, {companyId}, {documentType}, {year}, {pattern})
               ON CONFLICT (""CompanyId"", ""DocumentType"", ""Year"") DO NOTHING");

        return await _db.NumberSeriesSet
            .FirstAsync(s => s.CompanyId == companyId && s.DocumentType == documentType && s.Year == year);
    }

    /// <summary>
    /// InMemory-only: finds or creates a series in the EF tracker. No SaveChangesAsync needed
    /// because InMemory has no real DB — the entity is tracked and visible immediately.
    /// </summary>
    private async Task<NumberSeries> GetOrCreateSeriesAsync(Guid companyId, string documentType, int year)
    {
        var series = await _db.NumberSeriesSet
            .FirstOrDefaultAsync(s => s.CompanyId == companyId && s.DocumentType == documentType && s.Year == year);

        if (series != null) return series;

        series = new NumberSeries
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            DocumentType = documentType,
            Year = year,
            Pattern = DefaultPattern(documentType)
        };
        _db.NumberSeriesSet.Add(series);
        return series;
    }

    public static string FormatNumber(string pattern, int sequenceValue, int year)
    {
        var result = pattern;

        if (result.Contains("{seq:"))
        {
            var start = result.IndexOf("{seq:", StringComparison.Ordinal);
            var end = result.IndexOf('}', start);
            var formatSpec = result[(start + 5)..end];
            result = result[..start] + sequenceValue.ToString(formatSpec) + result[(end + 1)..];
        }
        else
        {
            result = result.Replace("{seq}", sequenceValue.ToString());
        }

        result = result.Replace("{yyyy}", year.ToString("D4"));
        result = result.Replace("{mm}", DateTime.UtcNow.Month.ToString("D2"));

        return result;
    }

    public static string DefaultPattern(string documentType) => documentType switch
    {
        "Invoice" => "{seq:D2}/{yyyy}",
        "CreditNote" => "CN-{seq:D4}",
        "DebitNote" => "DN-{seq:D4}",
        "DownPayment" => "DP-{seq:D4}",
        "SalesReturn" => "SR-{seq:D4}",
        "Proforma" => "PRO-{seq:D4}",
        "Item" => "{seq}",
        _ => "{seq:D4}"
    };

    public static string DocumentTypeKey(DocumentType dt) => dt.ToString();
}
