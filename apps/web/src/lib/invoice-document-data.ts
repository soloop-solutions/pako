import type { TaxDefinitionResponse } from "@pako/shared";

import { computeLine } from "@/lib/tax-enums";

import type { InvoiceDocumentData, InvoiceLineData } from "@/components/shared/InvoiceDocument";

// ---------------------------------------------------------------------------
// Helpers to build InvoiceDocumentData from different sources.
// Separated from InvoiceDocument.tsx so that file exports only the React
// component (react-refresh/only-export-components).
// ---------------------------------------------------------------------------

export type CompanyDocumentInfo = {
  name: string;
  vatNumber?: string;
  fiscalNumber?: string;
  businessNumber?: string;
  streetAddress?: string;
  municipality?: string;
  country?: string;
  phone?: string;
  email?: string;
  iban?: string;
  bankName?: string;
  paymentInstructions?: string;
  documentFooter?: string;
};

function buildCompanyBlock(c: CompanyDocumentInfo) {
  return {
    name: c.name,
    vatNumber: c.vatNumber,
    fiscalNumber: c.fiscalNumber,
    businessNumber: c.businessNumber,
    address: c.streetAddress,
    municipality: c.municipality,
    country: c.country,
    phone: c.phone,
    email: c.email,
    iban: c.iban,
    bankName: c.bankName,
    paymentInstructions: c.paymentInstructions,
    documentFooter: c.documentFooter,
  };
}

interface TaxInput {
  id: string;
  name: string;
  rate: number;
  code?: string | null;
  isReverseCharge?: boolean;
}

/** Stage A: build from unsaved form values */
export function buildDocumentDataFromForm(opts: {
  company: CompanyDocumentInfo;
  customer: { name: string; taxNumber?: string; fiscalNumber?: string; isVatRegistered?: boolean } | undefined;
  lines: { description: string; quantity: string; unitPrice: string; discountPercent: string; taxDefinitionId: string }[];
  taxes: TaxInput[];
  documentType: number;
  issueDate: string;
  dueDate: string;
  priceMode: number;
  internalNotes?: string;
  paymentTermDays?: string;
  originalDocumentNumber?: string;
  currency?: string;
}): InvoiceDocumentData {
  const resolvedLines: InvoiceLineData[] = opts.lines
    .filter((l) => l.description.trim() || parseFloat(l.quantity) > 0 || parseFloat(l.unitPrice) > 0)
    .map((l) => {
      const qty = parseFloat(l.quantity) || 0;
      const price = parseFloat(l.unitPrice) || 0;
      const disc = parseFloat(l.discountPercent) || 0;
      const enteredAmount = qty * price * (1 - disc / 100);
      const taxDef = opts.taxes.find((t) => t.id === l.taxDefinitionId);
      const computed = computeLine(enteredAmount, taxDef as TaxDefinitionResponse | undefined, opts.priceMode);
      return {
        description: l.description,
        quantity: qty,
        unitPrice: price,
        discountPercent: disc,
        tax: taxDef ? { id: taxDef.id, name: taxDef.name, rate: taxDef.rate, code: taxDef.code ?? undefined, isReverseCharge: taxDef.isReverseCharge } : undefined,
        net: computed.net,
        taxAmount: computed.tax,
        gross: computed.gross,
      };
    });

  return {
    documentType: opts.documentType,
    state: "Preview",
    issueDate: opts.issueDate,
    dueDate: opts.dueDate,
    priceMode: opts.priceMode,
    internalNotes: opts.internalNotes,
    paymentTermDays: opts.paymentTermDays ? parseInt(opts.paymentTermDays, 10) || undefined : undefined,
    company: buildCompanyBlock(opts.company),
    customer: opts.customer ?? { name: "\u2014" },
    lines: resolvedLines,
    originalDocumentNumber: opts.originalDocumentNumber,
    currency: opts.currency ?? "EUR",
  };
}

/** Stage B/C: build from an API InvoiceResponse */
export function buildDocumentDataFromResponse(opts: {
  invoice: {
    id: string;
    invoiceNumber?: string;
    state: string;
    documentType: number;
    issueDate: string;
    dueDate: string;
    priceMode: number;
    internalNotes?: string;
    paymentTermDays?: number;
    originalInvoiceId?: string;
    lines: { description: string; quantity: number; unitPrice: number; discountPercent: number; taxDefinitionId?: string }[];
  };
  company: CompanyDocumentInfo;
  customer: { name: string; taxNumber?: string; fiscalNumber?: string; isVatRegistered?: boolean } | undefined;
  taxes: TaxInput[];
  originalDocumentNumber?: string;
  currency?: string;
}): InvoiceDocumentData {
  const resolvedLines: InvoiceLineData[] = opts.invoice.lines.map((l) => {
    const enteredAmount = l.quantity * l.unitPrice * (1 - l.discountPercent / 100);
    const taxDef = l.taxDefinitionId ? opts.taxes.find((t) => t.id === l.taxDefinitionId) : undefined;
    const computed = computeLine(enteredAmount, taxDef as TaxDefinitionResponse | undefined, opts.invoice.priceMode);
    return {
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      tax: taxDef ? { id: taxDef.id, name: taxDef.name, rate: taxDef.rate, code: taxDef.code ?? undefined, isReverseCharge: taxDef.isReverseCharge } : undefined,
      net: computed.net,
      taxAmount: computed.tax,
      gross: computed.gross,
    };
  });

  return {
    documentType: opts.invoice.documentType,
    invoiceNumber: opts.invoice.invoiceNumber ?? undefined,
    state: opts.invoice.state,
    issueDate: opts.invoice.issueDate,
    dueDate: opts.invoice.dueDate,
    priceMode: opts.invoice.priceMode,
    internalNotes: opts.invoice.internalNotes ?? undefined,
    paymentTermDays: opts.invoice.paymentTermDays ?? undefined,
    company: buildCompanyBlock(opts.company),
    customer: opts.customer ?? { name: "\u2014" },
    lines: resolvedLines,
    originalDocumentNumber: opts.originalDocumentNumber,
    currency: opts.currency ?? "EUR",
  };
}
