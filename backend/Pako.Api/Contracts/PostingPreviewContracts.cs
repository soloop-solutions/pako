namespace Pako.Api.Contracts;

public record PostingPreviewLineResponse(
    string AccountCode,
    string AccountName,
    decimal Debit,
    decimal Credit
);

public record PostingPreviewResponse(List<PostingPreviewLineResponse> Lines);
