import type { SelectOption } from '@/components/ui/select-field';

// Pako.Api doesn't emit enum member names (see ledger-enums.ts) - order must match
// backend/Pako.Domain/Invoicing/Invoice.cs's DocumentType and backend/Pako.Domain/Bills/Bill.cs's
// DocumentType by hand. Invoices and Bills each declare their own enum despite the shared name -
// Bills deliberately has no DebitNote/DownPayment (see root CLAUDE.md's credit-note section).
export const INVOICE_DOCUMENT_TYPE_INVOICE = 0;
export const INVOICE_DOCUMENT_TYPE_CREDIT_NOTE = 1;
export const INVOICE_DOCUMENT_TYPE_DEBIT_NOTE = 2;
export const INVOICE_DOCUMENT_TYPE_DOWN_PAYMENT = 3;

export const BILL_DOCUMENT_TYPE_BILL = 0;
export const BILL_DOCUMENT_TYPE_CREDIT_NOTE = 1;

export function invoiceDocumentTypeLabel(value: number): string {
  switch (value) {
    case INVOICE_DOCUMENT_TYPE_CREDIT_NOTE:
      return 'Credit Note';
    case INVOICE_DOCUMENT_TYPE_DEBIT_NOTE:
      return 'Debit Note';
    case INVOICE_DOCUMENT_TYPE_DOWN_PAYMENT:
      return 'Down Payment';
    default:
      return 'Invoice';
  }
}

export function billDocumentTypeLabel(value: number): string {
  return value === BILL_DOCUMENT_TYPE_CREDIT_NOTE ? 'Credit Note' : 'Bill';
}

export const INVOICE_DOCUMENT_TYPE_OPTIONS: SelectOption[] = [
  { value: String(INVOICE_DOCUMENT_TYPE_INVOICE), label: 'Invoice' },
  { value: String(INVOICE_DOCUMENT_TYPE_CREDIT_NOTE), label: 'Credit Note' },
  { value: String(INVOICE_DOCUMENT_TYPE_DEBIT_NOTE), label: 'Debit Note' },
  { value: String(INVOICE_DOCUMENT_TYPE_DOWN_PAYMENT), label: 'Down Payment' },
];

export const BILL_DOCUMENT_TYPE_OPTIONS: SelectOption[] = [
  { value: String(BILL_DOCUMENT_TYPE_BILL), label: 'Bill' },
  { value: String(BILL_DOCUMENT_TYPE_CREDIT_NOTE), label: 'Credit Note' },
];
