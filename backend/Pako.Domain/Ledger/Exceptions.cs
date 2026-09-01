using Pako.Domain.Tax;

namespace Pako.Domain.Ledger;

public class UnbalancedJournalEntryException : Exception
{
    public Guid JournalEntryId { get; }
    public decimal TotalDebit { get; }
    public decimal TotalCredit { get; }

    public UnbalancedJournalEntryException(Guid journalEntryId, decimal totalDebit, decimal totalCredit)
        : base($"Journal entry {journalEntryId} is unbalanced: debit {totalDebit} != credit {totalCredit}.")
    {
        JournalEntryId = journalEntryId;
        TotalDebit = totalDebit;
        TotalCredit = totalCredit;
    }
}

public class AccountingLockDateViolationException : Exception
{
    public Guid JournalEntryId { get; }
    public DateOnly EntryDate { get; }
    public DateOnly LockDate { get; }

    public AccountingLockDateViolationException(Guid journalEntryId, DateOnly entryDate, DateOnly lockDate)
        : base($"Journal entry {journalEntryId} dated {entryDate} is on or before the company's accounting lock date {lockDate}.")
    {
        JournalEntryId = journalEntryId;
        EntryDate = entryDate;
        LockDate = lockDate;
    }
}

public class TaxLockDateViolationException : Exception
{
    public Guid JournalEntryId { get; }
    public DateOnly EntryDate { get; }
    public DateOnly LockDate { get; }

    public TaxLockDateViolationException(Guid journalEntryId, DateOnly entryDate, DateOnly lockDate)
        : base($"Journal entry {journalEntryId} dated {entryDate} is on or before the company's tax lock date {lockDate}.")
    {
        JournalEntryId = journalEntryId;
        EntryDate = entryDate;
        LockDate = lockDate;
    }
}

public class PostedJournalEntryImmutableException : Exception
{
    public Guid JournalEntryId { get; }

    public PostedJournalEntryImmutableException(Guid journalEntryId)
        : base($"Journal entry {journalEntryId} is Posted and cannot be modified or deleted; create a reversing entry instead.")
    {
        JournalEntryId = journalEntryId;
    }
}

// 60_Posting_Rules R02 (BLOCK): a line may only post to an account where IsPostable = true.
public class NonPostableAccountException : Exception
{
    public string AccountCode { get; }

    public NonPostableAccountException(string accountCode)
        : base($"Account {accountCode} is not postable.")
    {
        AccountCode = accountCode;
    }
}

// 60_Posting_Rules R03 (BLOCK, Partner subledger only — see PostingRuleValidator's own doc
// comment for why Item/Asset/Employee/Customs aren't enforced): an account whose Subledger
// requires a matching reference must have one on the line.
public class MissingSubledgerReferenceException : Exception
{
    public string AccountCode { get; }
    public SubledgerType Subledger { get; }

    public MissingSubledgerReferenceException(string accountCode, SubledgerType subledger)
        : base($"Account {accountCode} requires a {subledger} subledger reference on the line.")
    {
        AccountCode = accountCode;
        Subledger = subledger;
    }
}

// 60_Posting_Rules R04 (BLOCK): control accounts accept only subledger-document postings
// (Invoice/Bill/PayrollRun), never a manual journal entry.
public class ControlAccountManualPostingException : Exception
{
    public string AccountCode { get; }

    public ControlAccountManualPostingException(string accountCode)
        : base($"Account {accountCode} is a control account and cannot receive a manual journal entry.")
    {
        AccountCode = accountCode;
    }
}

// 60_Posting_Rules R05 (BLOCK): 304100 Current Year Profit/Loss is system-computed.
public class SystemComputedAccountPostingException : Exception
{
    public string AccountCode { get; }

    public SystemComputedAccountPostingException(string accountCode)
        : base($"Account {accountCode} is system-computed; manual posting is forbidden.")
    {
        AccountCode = accountCode;
    }
}

// 60_Posting_Rules R07 (BLOCK): a line with a VAT code other than NA requires a counterparty
// with a fiscal/personal number — ATK EDI rejects books without it.
public class MissingCounterpartyTaxNumberException : Exception
{
    public string VatCode { get; }

    public MissingCounterpartyTaxNumberException(string vatCode)
        : base($"VAT code {vatCode} requires a counterparty with a NUI / Fiscal Number / Personal Number.")
    {
        VatCode = vatCode;
    }
}

// 60_Posting_Rules R08 (BLOCK): VAT code direction must match the posting account's class —
// OUT codes only on class 4, IN/IMP/RC codes only on classes 1, 5, 6.
public class VatDirectionAccountClassMismatchException : Exception
{
    public string VatCode { get; }
    public TaxDirection Direction { get; }
    public int AccountClass { get; }

    public VatDirectionAccountClassMismatchException(string vatCode, TaxDirection direction, int accountClass)
        : base($"VAT code {vatCode} ({direction}) cannot be applied to a class {accountClass} account.")
    {
        VatCode = vatCode;
        Direction = direction;
        AccountClass = accountClass;
    }
}

// 60_Posting_Rules R09 (BLOCK): VAT codes may never be applied to the VAT control accounts
// themselves (113xxx / 210xxx).
public class VatOnControlAccountException : Exception
{
    public string VatCode { get; }
    public string AccountCode { get; }

    public VatOnControlAccountException(string vatCode, string accountCode)
        : base($"VAT code {vatCode} cannot be applied to VAT control account {accountCode}.")
    {
        VatCode = vatCode;
        AccountCode = accountCode;
    }
}

// 60_Posting_Rules R19 (BLOCK): a foreign-currency line must store OriginalCurrency,
// OriginalAmount and ExchangeRate together, or none of them — a partial set can't be reconciled
// back to the functional-currency Debit/Credit.
public class InconsistentForeignCurrencyDataException : Exception
{
    public Guid LineId { get; }

    public InconsistentForeignCurrencyDataException(Guid lineId)
        : base($"Journal entry line {lineId} has an incomplete set of foreign-currency fields — OriginalCurrency, OriginalAmount and ExchangeRate must all be set together, or none of them.")
    {
        LineId = lineId;
    }
}
