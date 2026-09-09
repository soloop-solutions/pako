namespace Pako.Api.Contracts;

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
