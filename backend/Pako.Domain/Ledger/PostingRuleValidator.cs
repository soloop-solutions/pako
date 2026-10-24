using Pako.Domain.Tax;

namespace Pako.Domain.Ledger;

// 60_Posting_Rules (COA_V2_IMPLEMENTATION_BRIEF.md Stage 4). Pure functions over already-loaded
// primitives — no EF dependency, same "domain validator, caller does the DB lookups" pattern
// Pako.Domain.Reconciliation.ReconciliationValidator already established. Each check throws its
// own exception type (Exceptions.cs) rather than returning a bool, matching
// UnbalancedJournalEntryException's existing style.
public static class PostingRuleValidator
{
    // R02 + R04 + R05: intrinsic account eligibility for a manual journal-entry line. R04/R05
    // don't apply to subledger-document posting (Invoice/Bill/PayrollRun legitimately post to
    // control accounts as their whole purpose), so this is only called from
    // JournalEntriesController — not from Invoice.Post/Bill.Post/PayrollRun.Post.
    public static void ValidateManualLineAccountEligibility(string accountCode, bool isPostable, bool isControl)
    {
        if (!isPostable)
        {
            throw new NonPostableAccountException(accountCode);
        }

        if (isControl)
        {
            throw new ControlAccountManualPostingException(accountCode);
        }

        if (accountCode == "304100")
        {
            throw new SystemComputedAccountPostingException(accountCode);
        }
    }

    // R03, Partner subledger only — retained for document-posting paths that may call it in the
    // future, but NOT called from the manual journal-entry path (JournalEntriesController.Create):
    // R04 already blocks manual posting to control accounts (the only accounts where a partner
    // reference is truly mandatory), and non-control accounts with SubledgerType.Partner (revenue,
    // expense, etc.) use the tag as informational metadata for analytical reports, not as a hard
    // data-entry requirement. An accountant must be able to post adjusting and reclassification
    // entries to these accounts without selecting a partner.
    public static void ValidatePartnerSubledgerReference(string accountCode, SubledgerType subledger, Guid? partnerId)
    {
        if (subledger == SubledgerType.Partner && partnerId is null)
        {
            throw new MissingSubledgerReferenceException(accountCode, subledger);
        }
    }

    // R07: any line whose VAT code isn't NA needs a counterparty with a real identifier. B8 wires
    // Partner.IsVatRegistered to pick WHICH identifier that is — a VAT-registered counterparty
    // (a business) is identified by its TaxNumber; a non-VAT-registered one (typically a natural
    // person) has no TaxNumber to give, so FiscalNumber stands in for it instead. This is the
    // "with/without-VAT distinction on documents" the task asks for.
    public static void ValidateVatCounterpartyTaxNumber(string vatCode, Guid? partnerId, bool partnerIsVatRegistered, string? partnerTaxNumber, string? partnerFiscalNumber)
    {
        if (vatCode == "NA")
        {
            return;
        }

        if (partnerId is null)
        {
            throw new MissingCounterpartyTaxNumberException(vatCode);
        }

        var hasRequiredIdentifier = partnerIsVatRegistered
            ? !string.IsNullOrWhiteSpace(partnerTaxNumber)
            : !string.IsNullOrWhiteSpace(partnerFiscalNumber);

        if (!hasRequiredIdentifier)
        {
            throw new MissingCounterpartyTaxNumberException(vatCode);
        }
    }

    // R08: OUT codes only post on class 4 (income) accounts; IN/IMP/RC codes only on classes
    // 1, 5, 6 (assets/COGS/opex). Direction.None (NA) applies everywhere — it's the "no VAT
    // mechanics" code, used on balance-sheet and payroll accounts of any class.
    public static void ValidateVatDirectionAgainstAccountClass(string vatCode, TaxDirection direction, int accountClass)
    {
        var valid = direction switch
        {
            TaxDirection.Out => accountClass == 4,
            TaxDirection.In or TaxDirection.Imp or TaxDirection.Rc => accountClass is 1 or 5 or 6,
            _ => true
        };

        if (!valid)
        {
            throw new VatDirectionAccountClassMismatchException(vatCode, direction, accountClass);
        }
    }

    // R09: a VAT code may never be applied directly to a VAT control account (113xxx input,
    // 210xxx output) — those accounts are the target of the tax posting, not a line that itself
    // carries a tax code.
    public static void ValidateVatNotAppliedToControlAccount(string vatCode, string accountCode)
    {
        if (accountCode.StartsWith("113", StringComparison.Ordinal) || accountCode.StartsWith("210", StringComparison.Ordinal))
        {
            throw new VatOnControlAccountException(vatCode, accountCode);
        }
    }
}
