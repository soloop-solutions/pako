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

    // R03, Partner subledger only. Item/Asset/Employee/Customs are NOT enforced here:
    // JournalEntryLine has no ItemId/AssetId/EmployeeId/CustomsDocumentId field to check against
    // (only PartnerId exists), so enforcing those would mean rejecting every line against such
    // an account outright rather than genuinely validating a reference — a fake implementation,
    // not a real one. Bank/Cash/Tax subledgers aren't enforced either: reconciling against a
    // bank statement (R22) or a specific tax filing isn't a per-line reference concept the way a
    // partner is.
    public static void ValidatePartnerSubledgerReference(string accountCode, SubledgerType subledger, Guid? partnerId)
    {
        if (subledger == SubledgerType.Partner && partnerId is null)
        {
            throw new MissingSubledgerReferenceException(accountCode, subledger);
        }
    }

    // R07: any line whose VAT code isn't NA needs a counterparty with a real tax number.
    public static void ValidateVatCounterpartyTaxNumber(string vatCode, Guid? partnerId, string? partnerTaxNumber)
    {
        if (vatCode == "NA")
        {
            return;
        }

        if (partnerId is null || string.IsNullOrWhiteSpace(partnerTaxNumber))
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
