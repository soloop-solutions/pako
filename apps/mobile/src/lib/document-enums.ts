import type { IntlShape } from 'react-intl';

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

export function invoiceDocumentTypeLabel(value: number, intl: IntlShape): string {
  switch (value) {
    case INVOICE_DOCUMENT_TYPE_CREDIT_NOTE:
      return intl.formatMessage({ id: 'docType.creditNote' });
    case INVOICE_DOCUMENT_TYPE_DEBIT_NOTE:
      return intl.formatMessage({ id: 'docType.debitNote' });
    case INVOICE_DOCUMENT_TYPE_DOWN_PAYMENT:
      return intl.formatMessage({ id: 'docType.downPayment' });
    default:
      return intl.formatMessage({ id: 'docType.invoice' });
  }
}

export function billDocumentTypeLabel(value: number, intl: IntlShape): string {
  return value === BILL_DOCUMENT_TYPE_CREDIT_NOTE
    ? intl.formatMessage({ id: 'docType.creditNote' })
    : intl.formatMessage({ id: 'docType.bill' });
}

export function invoiceDocumentTypeOptions(intl: IntlShape): SelectOption[] {
  return [
    { value: String(INVOICE_DOCUMENT_TYPE_INVOICE), label: intl.formatMessage({ id: 'docType.invoice' }) },
    { value: String(INVOICE_DOCUMENT_TYPE_CREDIT_NOTE), label: intl.formatMessage({ id: 'docType.creditNote' }) },
    { value: String(INVOICE_DOCUMENT_TYPE_DEBIT_NOTE), label: intl.formatMessage({ id: 'docType.debitNote' }) },
    { value: String(INVOICE_DOCUMENT_TYPE_DOWN_PAYMENT), label: intl.formatMessage({ id: 'docType.downPayment' }) },
  ];
}

export function billDocumentTypeOptions(intl: IntlShape): SelectOption[] {
  return [
    { value: String(BILL_DOCUMENT_TYPE_BILL), label: intl.formatMessage({ id: 'docType.bill' }) },
    { value: String(BILL_DOCUMENT_TYPE_CREDIT_NOTE), label: intl.formatMessage({ id: 'docType.creditNote' }) },
  ];
}
