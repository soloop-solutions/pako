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

public record SecureJournalRequest(DateOnly UpTo);

// B15: EntriesSecured counts only entries this call actually hashed (already-secured entries
// dated <= UpTo from an earlier call aren't re-counted); LatestHash/LatestSecureSequenceNumber
// describe the chain's watermark after this call, across both this run and any prior one.
public record SecureJournalResponse(int EntriesSecured, string? LatestHash, long? LatestSecureSequenceNumber);
