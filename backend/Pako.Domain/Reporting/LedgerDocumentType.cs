using Pako.Domain.Ledger;

namespace Pako.Domain.Reporting;

public static class LedgerDocumentType
{
    public static string Classify(string? invoiceType, string? billType, bool hasSourceDocument, JournalType journalType)
    {
        if (invoiceType is not null) return invoiceType;
        if (billType is not null) return billType switch
        {
            "CreditNote" => "SupplierCreditNote",
            var other => other
        };
        if (hasSourceDocument) return "Other";
        return journalType switch
        {
            JournalType.Cash or JournalType.Bank => "Payment",
            JournalType.Sale => "Invoice",
            JournalType.Purchase => "Bill",
            _ => "Manual"
        };
    }
}
