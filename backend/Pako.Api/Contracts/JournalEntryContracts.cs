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
