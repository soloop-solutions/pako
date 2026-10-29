using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
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
        return await ReserveNextAsync(companyId, documentType, new DateOnly(year, 1, 1));
    }

    /// <summary>
    /// Date-aware overload: uses the full document date for {dd}/{mm} placeholders and for
    /// day-scoped sequence derivation (patterns containing {dd} reset the counter per day).
    /// </summary>
    public async Task<string> ReserveNextAsync(Guid companyId, string documentType, DateOnly date)
    {
        var year = date.Year;
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

        var nextSeq = await GetNextSequenceValueAsync(companyId, documentType, year, series.Pattern, date);
        return FormatNumber(series.Pattern, nextSeq, year, date);
    }

    /// <summary>
    /// Returns what the next number would be without taking the serializing lock (B2: preview,
    /// clearly provisional — see NumberPreviewResponse.IsProvisional). Identical computation to
    /// ReserveNextAsync since neither one persists anything; this one just skips the lock, since a
    /// preview doesn't need to serialize against anything.
    /// </summary>
    public async Task<string> PreviewNextAsync(Guid companyId, string documentType, int year)
    {
        var date = new DateOnly(year, DateTime.UtcNow.Month, DateTime.UtcNow.Day);
        var series = await _db.NumberSeriesSet.AsNoTracking()
            .FirstOrDefaultAsync(s => s.CompanyId == companyId && s.DocumentType == documentType && s.Year == year);

        var pattern = series?.Pattern ?? DefaultPattern(documentType);
        var nextSeq = await GetNextSequenceValueAsync(companyId, documentType, year, pattern, date);
        return FormatNumber(pattern, nextSeq, year, date);
    }

    // B5: the highest sequence value already issued for this (company, document type), plus one.
    // Year-scoped patterns (contain {yyyy}, e.g. Invoice's "{seq:D2}/{yyyy}") only look at
    // documents issued in that same year, so the sequence resets the way the pattern's own display
    // implies. Day-scoped patterns (contain {dd}) narrow further to a single date, resetting the
    // counter daily — this is Format A (YYYYMMDD-counter). Patterns without {yyyy} or {dd}
    // (CN-/DN-/DP-/SR-/PRO-, Item's plain "{seq}") look across every year the company has ever
    // issued that type — a year-keyed lookup with a non-year-scoped pattern is exactly how the old
    // NextValue counter design could silently restart a sequence every January and collide with a
    // prior year's identical-looking number; deriving from the true historical max avoids that by
    // construction.
    private async Task<int> GetNextSequenceValueAsync(
        Guid companyId, string documentType, int year, string pattern, DateOnly? date = null)
    {
        var isYearScoped = pattern.Contains("{yyyy}");
        var isDayScoped = pattern.Contains("{dd}");

        if (documentType == "Item")
        {
            var maxItemCode = await _db.Items.AsNoTracking()
                .Where(i => i.CompanyId == companyId)
                .Select(i => (int?)i.Code)
                .MaxAsync() ?? 0;
            return maxItemCode + 1;
        }

        // Journal entries are stored in a separate table from invoices.
        if (documentType == "JournalEntry")
        {
            return await GetNextJournalEntrySequenceAsync(companyId, year, pattern, isDayScoped, isYearScoped, date);
        }

        if (!Enum.TryParse<DocumentType>(documentType, out var docType))
        {
            return 1;
        }

        var query = _db.Invoices.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.DocumentType == docType && i.InvoiceNumber != null);

        if (isDayScoped && date is { } d)
        {
            query = query.Where(i => i.IssueDate == d);
        }
        else if (isYearScoped)
        {
            // Date-range filter instead of EXTRACT(YEAR FROM ...) — EXTRACT on Postgres's
            // -infinity date (which Npgsql stores for DateOnly.MinValue) returns -Infinity
            // (double), and casting that to integer throws "22003: integer out of range".
            var yearStart = new DateOnly(year, 1, 1);
            var yearEnd = new DateOnly(year, 12, 31);
            query = query.Where(i => i.IssueDate >= yearStart && i.IssueDate <= yearEnd);
        }

        var issuedNumbers = await query.Select(i => i.InvoiceNumber!).ToListAsync();
        return MaxSequenceFrom(issuedNumbers, pattern) + 1;
    }

    private async Task<int> GetNextJournalEntrySequenceAsync(
        Guid companyId, int year, string pattern, bool isDayScoped, bool isYearScoped, DateOnly? date)
    {
        // Filter by the pattern's static prefix to distinguish NumberSeriesService-issued numbers
        // (e.g. "URD-000001") from JournalSequencer-issued numbers (e.g. "SAL-0001", "PUR-0001").
        // This includes both manual entries and their reversals (which also use NumberSeriesService).
        var prefix = ExtractStaticPrefix(pattern);

        var query = _db.JournalEntries.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.SequenceNumber != null);

        if (!string.IsNullOrEmpty(prefix))
        {
            query = query.Where(e => e.SequenceNumber!.StartsWith(prefix));
        }

        if (isDayScoped && date is { } d)
        {
            query = query.Where(e => e.Date == d);
        }
        else if (isYearScoped)
        {
            var yearStart = new DateOnly(year, 1, 1);
            var yearEnd = new DateOnly(year, 12, 31);
            query = query.Where(e => e.Date >= yearStart && e.Date <= yearEnd);
        }

        var issuedNumbers = await query.Select(e => e.SequenceNumber!).ToListAsync();
        return MaxSequenceFrom(issuedNumbers, pattern) + 1;
    }

    private static int MaxSequenceFrom(List<string> issuedNumbers, string pattern)
    {
        // Use pattern-aware extraction when the pattern contains date placeholders that would
        // confuse the simple first-digits heuristic. For non-date patterns the old heuristic
        // still works and is faster.
        var usePatternAware = pattern.Contains("{dd}") || pattern.Contains("{mm}");

        var maxSeq = 0;
        foreach (var number in issuedNumbers)
        {
            var seq = usePatternAware
                ? ExtractSequenceValueFromPattern(pattern, number)
                : ExtractSequenceValue(number);
            if (seq is { } s && s > maxSeq)
            {
                maxSeq = s;
            }
        }
        return maxSeq;
    }

    /// <summary>
    /// Extracts the sequence value from an issued number. Uses the first digit group, which is
    /// correct for all non-date patterns (e.g. "01/2026" → 1, "CN-0001" → 1). Callers with
    /// date-scoped patterns should use <see cref="ExtractSequenceValueFromPattern"/> instead.
    /// </summary>
    private static int? ExtractSequenceValue(string number)
    {
        var match = Regex.Match(number, @"\d+");
        return match.Success && int.TryParse(match.Value, out var val) ? val : null;
    }

    /// <summary>
    /// Pattern-aware extraction: computes the character offset of the sequence digits within the
    /// formatted number by measuring how many fixed-width characters precede {seq} in the pattern.
    /// This correctly handles date-based patterns where the date digits precede the counter.
    /// </summary>
    private static int? ExtractSequenceValueFromPattern(string pattern, string number)
    {
        // Compute the number of characters before {seq} in the output, by replacing each
        // known placeholder with its fixed-width equivalent.
        var seqStart = pattern.IndexOf("{seq", StringComparison.Ordinal);
        if (seqStart < 0) return ExtractSequenceValue(number);

        var prefix = pattern[..seqStart];
        var prefixLen = prefix
            .Replace("{yyyy}", "0000")
            .Replace("{mm}", "00")
            .Replace("{dd}", "00")
            .Length;

        // Find the end of {seq...}
        var seqEnd = pattern.IndexOf('}', seqStart);
        if (seqEnd < 0) return ExtractSequenceValue(number);

        var suffix = pattern[(seqEnd + 1)..];
        var suffixLen = suffix
            .Replace("{yyyy}", "0000")
            .Replace("{mm}", "00")
            .Replace("{dd}", "00")
            .Length;

        // The sequence digits are between prefixLen and (number.Length - suffixLen)
        var seqPartEnd = number.Length - suffixLen;
        if (prefixLen >= number.Length || prefixLen >= seqPartEnd) return null;

        var seqPart = number[prefixLen..seqPartEnd];
        return int.TryParse(seqPart, out var val) ? val : null;
    }

    /// <summary>
    /// Extracts the leading static text from a pattern (everything before the first placeholder).
    /// E.g. "URD-{seq:D6}" → "URD-", "{yyyy}{mm}{dd}-{seq:D4}" → "" (starts with placeholder).
    /// </summary>
    public static string ExtractStaticPrefix(string pattern)
    {
        var idx = pattern.IndexOf('{');
        return idx > 0 ? pattern[..idx] : string.Empty;
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

    /// <summary>
    /// Formats a number from a pattern, sequence value, year, and optional document date.
    /// When date is provided, {mm} and {dd} use the document date; otherwise {mm} falls back
    /// to UTC now (preview) and {dd} is left empty.
    /// </summary>
    public static string FormatNumber(string pattern, int sequenceValue, int year, DateOnly? date = null)
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
        result = result.Replace("{mm}", date?.Month.ToString("D2") ?? DateTime.UtcNow.Month.ToString("D2"));
        result = result.Replace("{dd}", date?.Day.ToString("D2") ?? DateTime.UtcNow.Day.ToString("D2"));

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
        "JournalEntry" => "URD-{seq:D6}",
        "Item" => "{seq}",
        _ => "{seq:D4}"
    };

    public static string DocumentTypeKey(DocumentType dt) => dt.ToString();
}
