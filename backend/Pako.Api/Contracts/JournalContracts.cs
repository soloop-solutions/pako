using Pako.Domain.Ledger;

namespace Pako.Api.Contracts;

public record CreateJournalRequest(JournalType Type, string Code, string Name);

public record JournalResponse(
    Guid Id,
    JournalType Type,
    string Code,
    string Name,
    string SequencePrefix,
    int SequenceNextNumber,
    int SequencePadding);
