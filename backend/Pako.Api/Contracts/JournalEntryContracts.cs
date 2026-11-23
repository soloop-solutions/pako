namespace Pako.Api.Contracts;

public record CreateJournalEntryLineRequest(Guid AccountId, Guid? PartnerId, decimal Debit, decimal Credit, string? Description, Dictionary<Guid, decimal>? AnalyticDistribution = null, Guid? ProjectId = null, Guid? EmployeeId = null);

public record CreateJournalEntryRequest(
    Guid JournalId,
    DateOnly Date,
    string? Reference,
    List<CreateJournalEntryLineRequest> Lines,
    string? Description = null,
    string? Remarks = null);

public record ReverseJournalEntryRequest(DateOnly Date, string? Reference = null);

public record JournalEntryLineResponse(Guid Id, Guid AccountId, Guid? PartnerId, decimal Debit, decimal Credit, string? Description, Dictionary<Guid, decimal>? AnalyticDistribution, Guid? ProjectId, Guid? EmployeeId);

public record JournalEntryResponse(
    Guid Id,
    Guid JournalId,
    DateOnly Date,
    string? Description,
    string? Reference,
    string? Remarks,
    string State,
    string? SequenceNumber,
    DateTime? PostedAtUtc,
    List<JournalEntryLineResponse> Lines);

public record JournalEntrySourceLineResponse(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    decimal DiscountPercent,
    decimal NetAmount,
    decimal TaxAmount,
    decimal GrossAmount);

public record JournalEntrySourceDocumentResponse(
    string Kind,
    Guid Id,
    string? DocumentNumber,
    DateOnly? Date,
    Guid? PartnerId,
    string? PartnerName,
    string? Notes,
    List<JournalEntrySourceLineResponse> Lines,
    decimal NetAmount,
    decimal TaxAmount,
    decimal GrossAmount);

public record JournalEntryDetailResponse(
    Guid Id,
    Guid JournalId,
    DateOnly Date,
    string? Description,
    string? Reference,
    string? Remarks,
    string State,
    string? SequenceNumber,
    DateTime? PostedAtUtc,
    List<JournalEntryLineResponse> Lines,
    string SourceKind,
    Guid SourceId,
    JournalEntrySourceDocumentResponse? SourceDocument = null);
