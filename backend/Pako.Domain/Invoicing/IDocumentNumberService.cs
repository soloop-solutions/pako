using Pako.Domain.Companies;

namespace Pako.Domain.Invoicing;

// S0.1: numbering used to live inline at the end of Invoice.Post() (`InvoiceNumber = DocumentType
// switch { ... }` calling company.ReserveNext*Number()). Extracted so Track B can change how
// numbers are minted (NumberSeries, manual override, etc.) without ever touching Invoice.cs — the
// controller is now the only caller, inside the same post transaction as before, so the "a failed
// post never burns a number" guarantee is unchanged: this only runs after JournalEntry.Post()
// already succeeded.
public interface IDocumentNumberService
{
    string ReserveNext(Company company, DocumentType documentType);
}

public class DocumentNumberService : IDocumentNumberService
{
    public string ReserveNext(Company company, DocumentType documentType) => documentType switch
    {
        DocumentType.CreditNote => company.ReserveNextCreditNoteNumber(),
        DocumentType.DebitNote => company.ReserveNextDebitNoteNumber(),
        DocumentType.DownPayment => company.ReserveNextDownPaymentNumber(),
        _ => company.ReserveNextInvoiceNumber()
    };
}
