// Pako.Api doesn't emit enum member names (see ledger-enums.ts) - order must match
// backend/Pako.Domain/Invoicing/DocumentType.cs and backend/Pako.Domain/Bills/DocumentType.cs by hand.

import type { IntlShape } from "react-intl";

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

const INVOICE_DOCUMENT_TYPE_KEYS = [
  "enum.invoiceDocumentType.invoice",
  "enum.invoiceDocumentType.creditNote",
  "enum.invoiceDocumentType.debitNote",
  "enum.invoiceDocumentType.downPayment",
];

const BILL_DOCUMENT_TYPE_KEYS = [
  "enum.billDocumentType.bill",
  "enum.billDocumentType.creditNote",
];

export function invoiceDocumentTypeLabel(documentType: number, intl: IntlShape): string {
  const key = INVOICE_DOCUMENT_TYPE_KEYS[documentType];
  return key ? intl.formatMessage({ id: key }) : intl.formatMessage({ id: "enum.unknown" });
}

export function billDocumentTypeLabel(documentType: number, intl: IntlShape): string {
  const key = BILL_DOCUMENT_TYPE_KEYS[documentType];
  return key ? intl.formatMessage({ id: key }) : intl.formatMessage({ id: "enum.unknown" });
}

export const INVOICE_DOCUMENT_TYPE_OPTION_KEYS = [
  { value: InvoiceDocumentType.Invoice, labelKey: "enum.invoiceDocumentType.invoice" },
  { value: InvoiceDocumentType.CreditNote, labelKey: "enum.invoiceDocumentType.creditNote" },
  { value: InvoiceDocumentType.DebitNote, labelKey: "enum.invoiceDocumentType.debitNote" },
  { value: InvoiceDocumentType.DownPayment, labelKey: "enum.invoiceDocumentType.downPayment" },
];

export const BILL_DOCUMENT_TYPE_OPTION_KEYS = [
  { value: BillDocumentType.Bill, labelKey: "enum.billDocumentType.bill" },
  { value: BillDocumentType.CreditNote, labelKey: "enum.billDocumentType.creditNote" },
];
