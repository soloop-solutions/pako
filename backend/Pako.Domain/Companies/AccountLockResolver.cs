namespace Pako.Domain.Companies;

// B4: computes each soft lock's EFFECTIVE date for a specific user, for the domain layer
// (Invoice.Post/Bill.Post/JournalEntry.Post) to read exactly as it already reads
// Company.AccountingLockDate today — no domain method signature changes needed.
public static class AccountLockResolver
{
    // Returns a detached copy of company — every field carried through unchanged except the four
    // soft lock dates, each replaced by its effective value for this user — for the domain layer
    // to read exactly as it reads the real entity today. Never the tracked entity itself: nothing
    // here risks an exception's date getting saved back onto the real company row. HardLockDate
    // is copied through untouched; it has no exception path.
    // Field list is explicit (no MemberwiseClone — that's `protected` on object, and this class
    // isn't Company or a subclass of it) and will silently miss a newly-added Company field until
    // this list is updated to match; nothing else in the domain layer reads through this clone
    // today besides the lock-date fields, so a missed field is inert rather than wrong, but keep
    // this in sync with Company.cs's property list regardless.
    public static Company ApplyEffectiveLocks(Company company, Guid userId, IReadOnlyCollection<AccountLockException> liveExceptionsForUser)
    {
        return new Company
        {
            Id = company.Id,
            Name = company.Name,
            FirmId = company.FirmId,
            AccountingLockDate = Effective(company.AccountingLockDate, LockDateField.AccountingLockDate),
            TaxLockDate = Effective(company.TaxLockDate, LockDateField.TaxLockDate),
            SaleLockDate = Effective(company.SaleLockDate, LockDateField.SaleLockDate),
            PurchaseLockDate = Effective(company.PurchaseLockDate, LockDateField.PurchaseLockDate),
            HardLockDate = company.HardLockDate,
            NextInvoiceNumber = company.NextInvoiceNumber,
            NextCreditNoteNumber = company.NextCreditNoteNumber,
            NextDebitNoteNumber = company.NextDebitNoteNumber,
            NextDownPaymentNumber = company.NextDownPaymentNumber,
            NextSalesReturnNumber = company.NextSalesReturnNumber,
            NextProformaNumber = company.NextProformaNumber,
            FunctionalCurrency = company.FunctionalCurrency,
            EnabledProfiles = company.EnabledProfiles,
            IsVatRegistered = company.IsVatRegistered,
            AllowNumberOverride = company.AllowNumberOverride
        };

        DateOnly? Effective(DateOnly? companyDate, LockDateField field)
        {
            var exception = liveExceptionsForUser.FirstOrDefault(e => e.UserId == userId && e.LockDateField == field);
            return exception is not null ? exception.LockDate : companyDate;
        }
    }
}
