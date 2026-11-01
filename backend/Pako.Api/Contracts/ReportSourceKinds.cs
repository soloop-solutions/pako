namespace Pako.Api.Contracts;

public static class ReportSourceKinds
{
    public const string Invoice = "Invoice";
    public const string SalesReturn = "SalesReturn";
    public const string Bill = "Bill";
    public const string PurchaseReturn = "PurchaseReturn";
    public const string PayrollRun = "PayrollRun";
    public const string StockDocument = "StockDocument";
    public const string JournalEntry = "JournalEntry";

    public static string ForInvoice(Pako.Domain.Invoicing.DocumentType documentType) =>
        documentType == Pako.Domain.Invoicing.DocumentType.SalesReturn ? SalesReturn : Invoice;

    public static string ForBill(Pako.Domain.Bills.DocumentType documentType) =>
        documentType == Pako.Domain.Bills.DocumentType.PurchaseReturn ? PurchaseReturn : Bill;

    public static string ForInvoice(string documentType) =>
        documentType == nameof(Pako.Domain.Invoicing.DocumentType.SalesReturn) ? SalesReturn : Invoice;

    public static string ForBill(string documentType) =>
        documentType == nameof(Pako.Domain.Bills.DocumentType.PurchaseReturn) ? PurchaseReturn : Bill;
}
