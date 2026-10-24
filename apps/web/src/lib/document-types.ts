// Pako.Api doesn't emit enum member names (see ledger-enums.ts) - order must match
// backend/Pako.Domain/Invoicing/DocumentType.cs and backend/Pako.Domain/Bills/DocumentType.cs by hand.
// Track A (v2 release) appended SalesReturn/Proforma to Invoicing.DocumentType and PurchaseReturn
// to Bills.DocumentType, in that exact append order — matched here.

import type { IntlShape } from "react-intl";

export const InvoiceDocumentType = {
  Invoice: 0,
  CreditNote: 1,
  DebitNote: 2,
  DownPayment: 3,
  SalesReturn: 4,
  Proforma: 5,
} as const;

export const BillDocumentType = {
  Bill: 0,
  CreditNote: 1,
  PurchaseReturn: 2,
} as const;

const INVOICE_DOCUMENT_TYPE_KEYS = [
  "enum.invoiceDocumentType.invoice",
  "enum.invoiceDocumentType.creditNote",
  "enum.invoiceDocumentType.debitNote",
  "enum.invoiceDocumentType.downPayment",
  "enum.invoiceDocumentType.salesReturn",
  "enum.invoiceDocumentType.proforma",
];

const BILL_DOCUMENT_TYPE_KEYS = [
  "enum.billDocumentType.bill",
  "enum.billDocumentType.creditNote",
  "enum.billDocumentType.purchaseReturn",
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

// F7: NumberSeriesService.DocumentTypeKey(dt) => dt.ToString() — the backend's number-series
// preview/list endpoints key document types by the raw C# enum member name, not the numeric
// value. Same order as InvoiceDocumentType above; Bill has no entry here because Bill is never
// numbered by PAKO (VendorReference is vendor-supplied free text, not a PAKO-minted number — see
// BillsController.Post's own comment), so no preview is ever requested for it.
export const INVOICE_DOCUMENT_TYPE_NAMES = [
  "Invoice",
  "CreditNote",
  "DebitNote",
  "DownPayment",
  "SalesReturn",
  "Proforma",
] as const;

export function invoiceDocumentTypeName(documentType: number): string | undefined {
  return INVOICE_DOCUMENT_TYPE_NAMES[documentType];
}

const NUMBER_SERIES_DOCUMENT_TYPE_LABEL_KEYS: Record<string, string> = {
  Invoice: "enum.invoiceDocumentType.invoice",
  CreditNote: "enum.invoiceDocumentType.creditNote",
  DebitNote: "enum.invoiceDocumentType.debitNote",
  DownPayment: "enum.invoiceDocumentType.downPayment",
  SalesReturn: "enum.invoiceDocumentType.salesReturn",
  Proforma: "enum.invoiceDocumentType.proforma",
  JournalEntry: "enum.documentType.journalEntry",
};

// Numbering settings lists series by their raw string DocumentType key (NumberSeries.DocumentType
// is a plain string, not tied to either C# DocumentType enum — see its own doc comment). Falls
// back to the raw key itself for anything not in the map above, rather than hiding it — an
// unrecognized series (e.g. a future "Item" numbering series) should still be visible and
// editable, just without a translated label.
export function numberSeriesDocumentTypeLabel(documentType: string, intl: IntlShape): string {
  const key = NUMBER_SERIES_DOCUMENT_TYPE_LABEL_KEYS[documentType];
  return key ? intl.formatMessage({ id: key }) : documentType;
}

// ---------------------------------------------------------------------------
// Document state visual helpers
// ---------------------------------------------------------------------------
// Maps a document state string ("Draft" | "Posted" | "Cancelled") to the badge
// variant defined in badge.tsx. The badge component already carries purpose-built
// `draft`, `success` and `cancelled` variants with shape cues that survive
// greyscale print (dashed border for draft, line-through for cancelled, etc.).
export function documentStateBadgeVariant(state: string): "draft" | "success" | "cancelled" | "secondary" {
  switch (state) {
    case "Draft":
      return "draft";
    case "Posted":
      return "success";
    case "Cancelled":
      return "cancelled";
    default:
      return "secondary";
  }
}

// Row-level className for DataGrid's `getRowClassName` prop. Draft rows are
// slightly muted; cancelled rows are struck through and dimmed; posted rows
// keep the default styling.
export function getDocumentRowClassName(state: string): string | undefined {
  switch (state) {
    case "Draft":
      return "text-muted-foreground";
    case "Cancelled":
      return "line-through opacity-60";
    default:
      return undefined;
  }
}
