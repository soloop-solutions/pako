namespace Pako.Api.Contracts;

public record CreateJournalEntryLineRequest(Guid AccountId, Guid? PartnerId, decimal Debit, decimal Credit, string? Description);

public record CreateJournalEntryRequest(
    Guid JournalId,
    DateOnly Date,
    string? Reference,
    List<CreateJournalEntryLineRequest> Lines);

public record ReverseJournalEntryRequest(DateOnly Date, string? Reference = null);

public record JournalEntryLineResponse(Guid Id, Guid AccountId, Guid? PartnerId, decimal Debit, decimal Credit, string? Description);

public record JournalEntryResponse(
    Guid Id,
    Guid JournalId,
    DateOnly Date,
    string? Reference,
    string State,
    string? SequenceNumber,
    DateTime? PostedAtUtc,
    List<JournalEntryLineResponse> Lines);
