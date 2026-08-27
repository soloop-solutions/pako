// Pako.Api doesn't emit enum member names (see ledger-enums.ts) - order must match
// backend/Pako.Domain/Invoicing/DocumentType.cs and backend/Pako.Domain/Bills/DocumentType.cs by hand.
export const InvoiceDocumentType = {
  Invoice: 0,
  CreditNote: 1,
  DebitNote: 2,
  DownPayment: 3,
} as const;

export const BillDocumentType = {
  Bill: 0,
  CreditNote: 1,
} as const;

const INVOICE_DOCUMENT_TYPE_LABELS = ["Invoice", "Credit Note", "Debit Note", "Down Payment"];
const BILL_DOCUMENT_TYPE_LABELS = ["Bill", "Credit Note"];

export function invoiceDocumentTypeLabel(documentType: number): string {
  return INVOICE_DOCUMENT_TYPE_LABELS[documentType] ?? "Unknown";
}

export function billDocumentTypeLabel(documentType: number): string {
  return BILL_DOCUMENT_TYPE_LABELS[documentType] ?? "Unknown";
}

export const INVOICE_DOCUMENT_TYPE_OPTIONS = [
  { value: InvoiceDocumentType.Invoice, label: "Invoice" },
  { value: InvoiceDocumentType.CreditNote, label: "Credit Note" },
  { value: InvoiceDocumentType.DebitNote, label: "Debit Note" },
  { value: InvoiceDocumentType.DownPayment, label: "Down Payment" },
];

export const BILL_DOCUMENT_TYPE_OPTIONS = [
  { value: BillDocumentType.Bill, label: "Bill" },
  { value: BillDocumentType.CreditNote, label: "Credit Note" },
];
