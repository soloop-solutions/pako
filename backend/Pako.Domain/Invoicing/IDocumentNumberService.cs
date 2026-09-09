using Pako.Domain.Companies;

namespace Pako.Domain.Invoicing;

// B1: numbering now lives in NumberSeries rows (one per company + document type + year) rather
// than on Company.NextXxxNumber counters. The interface stays synchronous for the domain, but the
// real implementation (NumberSeriesDocumentNumberService in Pako.Api.Services) is async and takes
// a FOR UPDATE lock on the series row — callers in the controller layer call ReserveNextAsync.
public interface IDocumentNumberService
{
    string ReserveNext(Company company, DocumentType documentType);
}

// Kept for test fixtures that don't have a DbContext and just need a number string. Production
// code uses NumberSeriesDocumentNumberService (registered in DI) which goes through the DB.
public class DocumentNumberService : IDocumentNumberService
{
    public string ReserveNext(Company company, DocumentType documentType) => documentType switch
    {
        DocumentType.CreditNote => company.ReserveNextCreditNoteNumber(),
        DocumentType.DebitNote => company.ReserveNextDebitNoteNumber(),
        DocumentType.DownPayment => company.ReserveNextDownPaymentNumber(),
        DocumentType.SalesReturn => company.ReserveNextSalesReturnNumber(),
        DocumentType.Proforma => company.ReserveNextProformaNumber(),
        _ => company.ReserveNextInvoiceNumber()
    };
}
