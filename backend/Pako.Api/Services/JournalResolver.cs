using Microsoft.EntityFrameworkCore;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// B9: each document type posts to its own journal — Sale for Invoice, Purchase for Bill, Cash or
// Bank for a payment settlement depending on which kind of account the money actually moved
// through. Before this task every auto-routed post grabbed "the first journal for this company",
// which only ever worked because General was the only journal that existed; now that Sale/
// Purchase/Cash/Bank are seeded alongside it (CompaniesController.Create), that lookup would
// silently succeed against an arbitrary one of the five, so every such site asks for its own type
// explicitly instead. Manual journal entries (JournalEntriesController) are unaffected — the
// caller already picks a JournalId there, for any of the now-five journals.
public static class JournalResolver
{
    public static Task<Journal?> GetAsync(PakoDbContext db, Guid companyId, JournalType type) =>
        db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId && j.Type == type);

    // A settlement's own account tells you which of Cash/Bank it belongs on — RecordPayment
    // validates cashOrBankAccountId is one or the other before this is ever called.
    public static JournalType SettlementJournalType(AccountSubType cashOrBankAccountSubType) =>
        cashOrBankAccountSubType == AccountSubType.Bank ? JournalType.Bank : JournalType.Cash;
}
