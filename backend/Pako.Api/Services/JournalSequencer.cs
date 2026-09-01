using Pako.Domain.Ledger;

namespace Pako.Api.Services;

// R23 (BLOCK, COA_V2_IMPLEMENTATION_BRIEF.md Stage 4): "JournalEntry.SequenceNumber is still a
// nullable free-text field nothing populates — finish it using the same [FOR UPDATE] pattern [as
// invoice numbering]." JournalEntriesController.Post takes the full row-locked treatment (it's
// the one path where a bare Journal row lock is the only thing being serialized). The other
// posting paths (Invoice/Bill/PayrollRun.Post, JournalEntry.Reverse) call this same reserving
// logic but without their own dedicated row lock — Invoice.Post already locks the Company row
// for its own invoice-numbering counter, Bill/PayrollRun/Reverse lock nothing today. A genuinely
// concurrent pair of posts to the same journal from two different document types could still
// race on SequenceNextNumber in those paths; narrower than "unenforced," a documented gap, not
// silently pretended away.
public static class JournalSequencer
{
    public static string ReserveNext(Journal journal)
    {
        var number = $"{journal.SequencePrefix}-{journal.SequenceNextNumber.ToString().PadLeft(journal.SequencePadding, '0')}";
        journal.SequenceNextNumber++;
        return number;
    }
}
