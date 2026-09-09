using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Infrastructure;

namespace Pako.Api.Services;

/// <summary>
/// B1/B3: mints the next document number from the NumberSeries table with a FOR UPDATE row lock
/// (gapless, same approach as Odoo's ir.sequence no_gap mode). Falls back gracefully on InMemory
/// (no lock, still increments — safe for single-threaded test runs).
///
/// Stages the increment on the DbContext — callers must call SaveChangesAsync themselves.
/// </summary>
public class NumberSeriesService
{
    private readonly PakoDbContext _db;

    public NumberSeriesService(PakoDbContext db) => _db = db;

    /// <summary>
    /// Reserves the next number for the given company, document type, and year.
    /// On Postgres: takes FOR UPDATE lock on the series row for gapless concurrency.
    /// On InMemory (tests): no lock, just increments — safe for single-threaded runs.
    /// </summary>
    public async Task<string> ReserveNextAsync(Guid companyId, string documentType, int year)
    {
        NumberSeries series;

        if (_db.Database.SupportsRowLocking())
        {
            // Postgres path: ensure the row exists (separate SaveChanges so it's visible to
            // FOR UPDATE), then lock and reload.
            series = await EnsureSeriesExistsPostgresAsync(companyId, documentType, year);
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT \"Id\" FROM number_series WHERE \"Id\" = {series.Id} FOR UPDATE");
            await _db.Entry(series).ReloadAsync();
        }
        else
        {
            // InMemory path: just find or create in the tracker, no lock needed.
            series = await GetOrCreateSeriesAsync(companyId, documentType, year);
        }

        var number = FormatNumber(series.Pattern, series.NextValue, year);
        series.NextValue++;
        // Caller's SaveChangesAsync flushes the increment.

        return number;
    }

    /// <summary>
    /// Returns what the next number would be without reserving it (B2: preview).
    /// </summary>
    public async Task<string> PreviewNextAsync(Guid companyId, string documentType, int year)
    {
        var series = await _db.NumberSeriesSet.AsNoTracking()
            .FirstOrDefaultAsync(s => s.CompanyId == companyId && s.DocumentType == documentType && s.Year == year);

        if (series == null)
            return FormatNumber(DefaultPattern(documentType), 1, year);

        return FormatNumber(series.Pattern, series.NextValue, year);
    }

    /// <summary>
    /// Postgres-only: ensures the series row exists in the DB (committed, visible to FOR UPDATE).
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

        // Raw SQL insert, bypasses EF SaveChangesAsync entirely.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $@"INSERT INTO number_series (""Id"", ""CompanyId"", ""DocumentType"", ""Year"", ""Pattern"", ""NextValue"")
               VALUES ({id}, {companyId}, {documentType}, {year}, {pattern}, 1)
               ON CONFLICT (""CompanyId"", ""DocumentType"", ""Year"") DO NOTHING");

        // Re-fetch the tracked entity (may have been created by the INSERT or by a concurrent caller).
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
            Pattern = DefaultPattern(documentType),
            NextValue = 1
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
