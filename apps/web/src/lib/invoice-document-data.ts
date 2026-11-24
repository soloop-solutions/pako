import type { InvoiceDocumentData, InvoiceLineData, InvoiceVatRow } from "@/components/shared/InvoiceDocument";

// ---------------------------------------------------------------------------
// Builds InvoiceDocumentData (the printed invoice) from a saved invoice (the single-invoice GET) or
// from the unsaved form plus its server quote (POST invoices/quote). Amounts are copied from the
// server responses only; nothing here computes money. Kept apart from InvoiceDocument.tsx so that
// file exports only the component (react-refresh/only-export-components).
// ---------------------------------------------------------------------------

export type CompanyDocumentInfo = {
  name: string;
  tradingName?: string | null;
  legalForm?: number | null;
  vatNumber?: string | null;
  fiscalNumber?: string | null;
  businessNumber?: string | null;
  streetAddress?: string | null;
  postalCode?: string | null;
  municipality?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  iban?: string | null;
  bankName?: string | null;
  bankAccountHolder?: string | null;
  swiftBic?: string | null;
  /** The company's bank accounts list (CompaniesController bank-accounts), default first. */
  bankAccounts?: { bankName: string; accountHolder?: string; iban?: string; swiftBic?: string; isDefault?: boolean; sortOrder?: number }[];
  paymentInstructions?: string | null;
  documentFooter?: string | null;
  logoUrl?: string | null;
  stampUrl?: string | null;
  functionalCurrency?: string | null;
};

export type CustomerDocumentInfo = {
  name: string;
  taxNumber?: string | null;
  vatNumber?: string | null;
  fiscalNumber?: string | null;
  contactPerson?: string | null;
  streetAddress?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
};

interface TaxInput {
  id: string;
  name: string;
  rate: number;
}

type ServerLineAmounts = {
  discountAmount?: number;
  netAmount?: number;
  taxAmount?: number;
  grossAmount?: number;
  unitPriceNet?: number;
  unitPriceGross?: number;
};

type ServerTotals = { amountBeforeDiscount: number; discountAmount: number; netAmount: number; taxAmount: number; grossAmount: number };
type ServerVatRow = { taxDefinitionId: string; netAmount: number; taxAmount: number; grossAmount?: number };

// Same abbreviations as InvoiceDocumentService.LegalFormAbbreviation (LegalFormType 1–6, the ARBK forms).
const LEGAL_FORMS: Record<number, string> = { 1: "SH.P.K.", 2: "SH.A.", 3: "O.P.", 4: "O.K.", 5: "D.K.", 6: "Z.P.K." };

const opt = (value: string | null | undefined) => (value && value.trim() !== "" ? value : undefined);

function buildCompanyBlock(c: CompanyDocumentInfo): InvoiceDocumentData["company"] {
  const trading = opt(c.tradingName);
  return {
    name: trading ?? c.name,
    legalName: trading && trading !== c.name ? c.name : undefined,
    legalForm: c.legalForm != null ? LEGAL_FORMS[c.legalForm] : undefined,
    vatNumber: opt(c.vatNumber),
    fiscalNumber: opt(c.fiscalNumber),
    businessNumber: opt(c.businessNumber),
    address: opt(c.streetAddress),
    postalCode: opt(c.postalCode),
    municipality: opt(c.municipality),
    country: opt(c.country),
    phone: opt(c.phone),
    email: opt(c.email),
    website: opt(c.website),
    iban: opt(c.iban),
    bankName: opt(c.bankName),
    bankAccountHolder: opt(c.bankAccountHolder),
    swiftBic: opt(c.swiftBic),
    bankAccounts: c.bankAccounts
      ? [...c.bankAccounts]
          .sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((b) => ({ bankName: b.bankName, accountHolder: b.accountHolder, iban: b.iban, swiftBic: b.swiftBic }))
      : undefined,
    paymentInstructions: opt(c.paymentInstructions),
    documentFooter: opt(c.documentFooter),
    logoUrl: opt(c.logoUrl),
    stampUrl: opt(c.stampUrl),
  };
}

function buildCustomerBlock(c: CustomerDocumentInfo | undefined): InvoiceDocumentData["customer"] {
  if (!c) return { name: "—" };
  return {
    name: c.name,
    taxNumber: opt(c.taxNumber),
    vatNumber: opt(c.vatNumber),
    fiscalNumber: opt(c.fiscalNumber),
    contactPerson: opt(c.contactPerson),
    streetAddress: opt(c.streetAddress),
    postalCode: opt(c.postalCode),
    city: opt(c.city),
    country: opt(c.country),
    phone: opt(c.phone),
    email: opt(c.email),
  };
}

const rateLabel = (tax: TaxInput | undefined) => (tax ? `${+(tax.rate * 100).toFixed(2)}%` : undefined);

function vatRows(rows: ServerVatRow[] | undefined, taxes: TaxInput[]): InvoiceVatRow[] | undefined {
  return rows?.map((row) => {
    const tax = taxes.find((t) => t.id === row.taxDefinitionId);
    const rate = rateLabel(tax);
    const label = !tax ? "" : rate && tax.name.includes(rate) ? tax.name : `${tax.name} (${rate})`;
    return { label, base: row.netAmount, vat: row.taxAmount, gross: row.grossAmount };
  });
}

function totalsOf(t: ServerTotals | undefined) {
  return t ? { amountBeforeDiscount: t.amountBeforeDiscount, discountAmount: t.discountAmount, net: t.netAmount, tax: t.taxAmount, gross: t.grossAmount } : undefined;
}

function lineOf(
  line: { description: string; quantity: number; discountPercent: number; taxDefinitionId?: string; unitName?: string; itemCode?: string },
  amounts: ServerLineAmounts | undefined,
  taxes: TaxInput[],
): InvoiceLineData {
  return {
    itemCode: line.itemCode || undefined,
    description: line.description,
    unitName: line.unitName || undefined,
    quantity: line.quantity,
    discountPercent: line.discountPercent,
    taxRateLabel: rateLabel(taxes.find((t) => t.id === line.taxDefinitionId)),
    unitPriceNet: amounts?.unitPriceNet,
    unitPriceGross: amounts?.unitPriceGross,
    discountAmount: amounts?.discountAmount,
    net: amounts?.netAmount,
    taxAmount: amounts?.taxAmount,
    gross: amounts?.grossAmount,
  };
}

/** The unsaved form: its priced lines plus the server quote for exactly those lines (same order). */
export function buildDocumentDataFromForm(opts: {
  company: CompanyDocumentInfo;
  customer: CustomerDocumentInfo | undefined;
  lines: { description: string; quantity: number; discountPercent: number; taxDefinitionId?: string; unitName?: string; itemCode?: string }[];
  quote?: { lines: ServerLineAmounts[]; totals: ServerTotals; taxBreakdown: ServerVatRow[]; totalInWords: string };
  taxes: TaxInput[];
  documentType: number;
  issueDate: string;
  dueDate: string;
  priceMode: number;
  internalNotes?: string;
  paymentTermDays?: number;
  originalDocumentNumber?: string;
}): InvoiceDocumentData {
  return {
    documentType: opts.documentType,
    state: "Preview",
    issueDate: opts.issueDate,
    dueDate: opts.dueDate,
    priceMode: opts.priceMode,
    internalNotes: opt(opts.internalNotes),
    paymentTermDays: opts.paymentTermDays,
    company: buildCompanyBlock(opts.company),
    customer: buildCustomerBlock(opts.customer),
    lines: opts.lines.map((line, index) => lineOf(line, opts.quote?.lines[index], opts.taxes)),
    originalDocumentNumber: opts.originalDocumentNumber,
    currency: opts.company.functionalCurrency ?? "EUR",
    totals: totalsOf(opts.quote?.totals),
    vatRows: vatRows(opts.quote?.taxBreakdown, opts.taxes),
    totalInWords: opts.quote?.totalInWords,
  };
}

/** A saved invoice, from the single-invoice GET (which carries every amount). */
export function buildDocumentDataFromResponse(opts: {
  invoice: {
    invoiceNumber?: string;
    state: string;
    documentType: number;
    issueDate: string;
    dueDate: string;
    priceMode: number;
    internalNotes?: string;
    paymentTermDays?: number;
    lines: ({ description: string; quantity: number; discountPercent: number; taxDefinitionId?: string; unitName?: string; itemCode?: string } & ServerLineAmounts)[];
    totals?: ServerTotals;
    taxBreakdown?: ServerVatRow[];
    totalInWords?: string;
  };
  company: CompanyDocumentInfo;
  customer: CustomerDocumentInfo | undefined;
  taxes: TaxInput[];
  originalDocumentNumber?: string;
}): InvoiceDocumentData {
  const { invoice } = opts;
  return {
    documentType: invoice.documentType,
    invoiceNumber: invoice.invoiceNumber ?? undefined,
    state: invoice.state,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    priceMode: invoice.priceMode,
    internalNotes: opt(invoice.internalNotes),
    paymentTermDays: invoice.paymentTermDays ?? undefined,
    company: buildCompanyBlock(opts.company),
    customer: buildCustomerBlock(opts.customer),
    lines: invoice.lines.map((line) => lineOf(line, line, opts.taxes)),
    originalDocumentNumber: opts.originalDocumentNumber,
    currency: opts.company.functionalCurrency ?? "EUR",
    totals: totalsOf(invoice.totals),
    vatRows: vatRows(invoice.taxBreakdown, opts.taxes),
    totalInWords: invoice.totalInWords,
  };
}
