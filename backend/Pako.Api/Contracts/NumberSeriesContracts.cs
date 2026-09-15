namespace Pako.Api.Contracts;

// B5: NextValue is computed fresh (max existing + 1) on every read, never a stored column — see
// NumberSeries.cs's own doc comment. Field name kept as NextValue rather than renamed, since the
// meaning from the caller's side ("what number comes next") hasn't changed, just where it comes
// from.
public record NumberSeriesResponse(
    Guid Id,
    string DocumentType,
    int Year,
    string Pattern,
    int NextValue);

public record UpdateNumberSeriesPatternRequest(string Pattern);

public record NumberPreviewResponse(string Number, bool Provisional);

public record OverrideNumberRequest(string NewNumber);

public record GapReportEntry(int MissingSequenceValue, string FormattedNumber);

public record GapReportResponse(string DocumentType, int Year, List<GapReportEntry> Gaps);
