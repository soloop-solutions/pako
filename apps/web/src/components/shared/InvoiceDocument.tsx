import { useIntl } from "react-intl";

// ---------------------------------------------------------------------------
// InvoiceDocument — A pure, printable, A4-portrait invoice document.
//
// This component renders a professional customer-facing invoice that:
//  - Works for all document types (Invoice, CreditNote, DebitNote, DownPayment, SalesReturn, Proforma)
//  - Accepts pre-computed or raw line data (no API calls, no side effects)
//  - Shows DRAFT watermark for unpersisted/draft invoices
//  - Hides watermark for posted invoices
//  - Uses @media print CSS for clean printing
//  - Supports Albanian and English via react-intl
//  - Renders Albanian characters (ë, Ë, ç, Ç) correctly
//
// Data contract: the caller builds an InvoiceDocumentData object from whatever
// source they have (form state, API response, or a mix) — this component never
// fetches, never mutates, never posts.
// ---------------------------------------------------------------------------

export interface InvoiceLineData {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  /** Already-resolved tax definition, if any */
  tax?: { id: string; name: string; rate: number; code?: string; isReverseCharge?: boolean };
  /** Net, tax, gross — caller should compute these using computeLine() */
  net: number;
  taxAmount: number;
  gross: number;
}

export interface InvoiceDocumentData {
  /** "Invoice" | "CreditNote" | "DebitNote" | "DownPayment" | "SalesReturn" | "Proforma" */
  documentType: number;
  /** Official number (posted) or undefined (draft/unsaved) */
  invoiceNumber?: string;
  /** "Draft" | "Posted" | "Cancelled" | "Preview" (unsaved) */
  state: string;
  issueDate: string;
  dueDate: string;
  /** Price mode: 0 = GrossInclusive, 1 = NetExclusive */
  priceMode: number;
  /** Internal notes */
  internalNotes?: string;
  /** Payment term days */
  paymentTermDays?: number;

  /** Company (seller) information */
  company: {
    name: string;
    vatNumber?: string;
    fiscalNumber?: string;
    businessNumber?: string;
    address?: string;
    municipality?: string;
    country?: string;
    phone?: string;
    email?: string;
    iban?: string;
    bankName?: string;
    paymentInstructions?: string;
    documentFooter?: string;
  };

  /** Customer (buyer) information */
  customer: {
    name: string;
    taxNumber?: string;
    fiscalNumber?: string;
    isVatRegistered?: boolean;
  };

  /** Line items */
  lines: InvoiceLineData[];

  /** Original document reference (for returns, credit notes) */
  originalDocumentNumber?: string;

  /** Currency */
  currency: string;
}

// Document type to i18n key mapping
const DOCUMENT_TYPE_TITLE_KEYS: Record<number, string> = {
  0: "invoiceDoc.title.invoice",
  1: "invoiceDoc.title.creditNote",
  2: "invoiceDoc.title.debitNote",
  3: "invoiceDoc.title.downPayment",
  4: "invoiceDoc.title.salesReturn",
  5: "invoiceDoc.title.proforma",
};

function formatMoney(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return dateStr;
}

export function InvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  const intl = useIntl();

  const isDraft = data.state === "Draft" || data.state === "Preview";
  const titleKey = DOCUMENT_TYPE_TITLE_KEYS[data.documentType] ?? "invoiceDoc.title.invoice";

  // Compute totals
  const subtotal = data.lines.reduce((sum, line) => sum + line.net, 0);
  const totalDiscount = data.lines.reduce((sum, line) => {
    const beforeDiscount = line.quantity * line.unitPrice;
    const afterDiscount = beforeDiscount * (1 - line.discountPercent / 100);
    return sum + (beforeDiscount - afterDiscount);
  }, 0);
  const totalTax = data.lines.reduce((sum, line) => sum + line.taxAmount, 0);
  const grandTotal = data.lines.reduce((sum, line) => sum + line.gross, 0);

  // Group VAT by rate for breakdown
  const vatBreakdown = new Map<string, { label: string; rate: number; taxable: number; vat: number }>();
  for (const line of data.lines) {
    if (!line.tax) continue;
    const key = line.tax.id;
    const existing = vatBreakdown.get(key);
    if (existing) {
      existing.taxable += line.net;
      existing.vat += line.taxAmount;
    } else {
      vatBreakdown.set(key, {
        label: line.tax.name,
        rate: line.tax.rate,
        taxable: line.net,
        vat: line.taxAmount,
      });
    }
  }

  return (
    <div className="invoice-document relative mx-auto w-full bg-white text-black px-10 py-12 font-[system-ui,sans-serif] text-[13px] leading-[1.6] print:w-[210mm] print:min-h-[297mm] print:p-[20mm] print:text-[11px] print:leading-[1.5]">
      {/* DRAFT / PREVIEW watermark */}
      {isDraft && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-6xl font-bold text-gray-200 rotate-[-35deg] select-none tracking-widest print:text-[80px]">
            {data.state === "Preview"
              ? intl.formatMessage({ id: "invoiceDoc.watermark.preview" })
              : intl.formatMessage({ id: "invoiceDoc.watermark.draft" })}
          </span>
        </div>
      )}

      {/* HEADER */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-[22px] font-bold text-gray-800 mb-1 print:text-[24px]">
            {intl.formatMessage({ id: titleKey })}
          </h1>
          <p className="text-sm text-gray-500 print:text-[13px]">
            {data.invoiceNumber
              ? `${intl.formatMessage({ id: "invoiceDoc.number" })}: ${data.invoiceNumber}`
              : intl.formatMessage({ id: "invoiceDoc.draftReference" })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold text-gray-800 print:text-[16px]">{data.company.name}</p>
          {data.company.address && <p className="text-gray-500">{data.company.address}</p>}
          {data.company.municipality && (
            <p className="text-gray-500">
              {data.company.municipality}{data.company.country ? `, ${data.company.country}` : ""}
            </p>
          )}
          {data.company.vatNumber && (
            <p className="text-gray-500">{intl.formatMessage({ id: "invoiceDoc.vatNumber" })}: {data.company.vatNumber}</p>
          )}
          {data.company.fiscalNumber && (
            <p className="text-gray-500">{intl.formatMessage({ id: "invoiceDoc.fiscalNumber" })}: {data.company.fiscalNumber}</p>
          )}
          {data.company.businessNumber && (
            <p className="text-gray-500">{intl.formatMessage({ id: "invoiceDoc.businessNumber" })}: {data.company.businessNumber}</p>
          )}
          {data.company.phone && <p className="text-gray-500">{data.company.phone}</p>}
          {data.company.email && <p className="text-gray-500">{data.company.email}</p>}
        </div>
      </div>

      {/* INFO GRID */}
      <div className="grid grid-cols-2 gap-8 mb-8 pb-6 border-b border-gray-200">
        {/* Customer */}
        <div>
          <p className="text-[10px] font-semibold uppercase text-gray-400 mb-1 tracking-wider">
            {intl.formatMessage({ id: "invoiceDoc.billTo" })}
          </p>
          <p className="text-sm font-semibold text-gray-800 print:text-[13px]">{data.customer.name}</p>
          {data.customer.taxNumber && (
            <p className="text-gray-600">{intl.formatMessage({ id: "invoiceDoc.vatNumber" })}: {data.customer.taxNumber}</p>
          )}
          {data.customer.fiscalNumber && (
            <p className="text-gray-600">{intl.formatMessage({ id: "invoiceDoc.fiscalNumber" })}: {data.customer.fiscalNumber}</p>
          )}
        </div>

        {/* Dates & details */}
        <div className="text-right">
          <div className="inline-grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-right">
            <span className="text-gray-500">{intl.formatMessage({ id: "invoiceDoc.issueDate" })}:</span>
            <span className="font-medium">{formatDate(data.issueDate)}</span>
            <span className="text-gray-500">{intl.formatMessage({ id: "invoiceDoc.dueDate" })}:</span>
            <span className="font-medium">{formatDate(data.dueDate)}</span>
            {data.paymentTermDays != null && data.paymentTermDays > 0 && (
              <>
                <span className="text-gray-500">{intl.formatMessage({ id: "invoiceDoc.paymentTerms" })}:</span>
                <span className="font-medium">{intl.formatMessage({ id: "invoiceDoc.netDays" }, { days: data.paymentTermDays })}</span>
              </>
            )}
            <span className="text-gray-500">{intl.formatMessage({ id: "invoiceDoc.currency" })}:</span>
            <span className="font-medium">{data.currency}</span>
          </div>
          {data.originalDocumentNumber && (
            <p className="mt-2 text-gray-500">
              {intl.formatMessage({ id: "invoiceDoc.originalRef" })}: {data.originalDocumentNumber}
            </p>
          )}
        </div>
      </div>

      {/* ITEMS TABLE */}
      <table className="w-full mb-6 border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-800">
            <th className="py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:text-[10px] w-8">#</th>
            <th className="py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:text-[10px]">{intl.formatMessage({ id: "invoiceDoc.col.description" })}</th>
            <th className="py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 print:text-[10px] w-16">{intl.formatMessage({ id: "invoiceDoc.col.qty" })}</th>
            <th className="py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 print:text-[10px] w-24">{intl.formatMessage({ id: "invoiceDoc.col.unitPrice" })}</th>
            {totalDiscount > 0.005 && (
              <th className="py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 print:text-[10px] w-16">{intl.formatMessage({ id: "invoiceDoc.col.discount" })}</th>
            )}
            <th className="py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 print:text-[10px] w-16">{intl.formatMessage({ id: "invoiceDoc.col.vat" })}</th>
            <th className="py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 print:text-[10px] w-20">{intl.formatMessage({ id: "invoiceDoc.col.vatAmount" })}</th>
            <th className="py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 print:text-[10px] w-24">{intl.formatMessage({ id: "invoiceDoc.col.total" })}</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, index) => (
            <tr key={index} className="border-b border-gray-100">
              <td className="py-2 text-gray-400 tabular-nums">{index + 1}</td>
              <td className="py-2 text-gray-800">{line.description || "—"}</td>
              <td className="py-2 text-right tabular-nums">{line.quantity}</td>
              <td className="py-2 text-right tabular-nums">{line.unitPrice.toFixed(2)}</td>
              {totalDiscount > 0.005 && (
                <td className="py-2 text-right tabular-nums">{line.discountPercent > 0 ? `${line.discountPercent}%` : "—"}</td>
              )}
              <td className="py-2 text-right tabular-nums text-gray-500">
                {line.tax ? `${(line.tax.rate * 100).toFixed(0)}%` : "0%"}
              </td>
              <td className="py-2 text-right tabular-nums">{line.taxAmount.toFixed(2)}</td>
              <td className="py-2 text-right tabular-nums font-medium">{line.gross.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* TOTALS */}
      <div className="flex justify-end mb-8">
        <div className="w-72">
          <div className="flex justify-between py-1 text-gray-600">
            <span>{intl.formatMessage({ id: "invoiceDoc.subtotal" })}</span>
            <span className="tabular-nums">{formatMoney(subtotal, data.currency)}</span>
          </div>
          {totalDiscount > 0.005 && (
            <div className="flex justify-between py-1 text-gray-600">
              <span>{intl.formatMessage({ id: "invoiceDoc.totalDiscount" })}</span>
              <span className="tabular-nums">-{formatMoney(totalDiscount, data.currency)}</span>
            </div>
          )}
          {/* VAT breakdown */}
          {Array.from(vatBreakdown.values()).map((entry) => (
            <div key={entry.label} className="flex justify-between py-1 text-gray-600">
              <span>{entry.label} ({(entry.rate * 100).toFixed(0)}%)</span>
              <span className="tabular-nums">{formatMoney(entry.vat, data.currency)}</span>
            </div>
          ))}
          {totalTax > 0.005 && (
            <div className="flex justify-between py-1 text-gray-600 border-t border-gray-200 mt-1 pt-1">
              <span>{intl.formatMessage({ id: "invoiceDoc.totalVat" })}</span>
              <span className="tabular-nums">{formatMoney(totalTax, data.currency)}</span>
            </div>
          )}
          <div className="flex justify-between py-2 text-base font-bold text-gray-800 border-t-2 border-gray-800 mt-1 print:text-[14px]">
            <span>{intl.formatMessage({ id: "invoiceDoc.grandTotal" })}</span>
            <span className="tabular-nums">{formatMoney(grandTotal, data.currency)}</span>
          </div>
        </div>
      </div>

      {/* NOTES */}
      {data.internalNotes && (
        <div className="mb-6 pb-4 border-b border-gray-100">
          <p className="text-[10px] font-semibold uppercase text-gray-400 mb-1 tracking-wider">
            {intl.formatMessage({ id: "invoiceDoc.notes" })}
          </p>
          <p className="text-gray-600 whitespace-pre-line">{data.internalNotes}</p>
        </div>
      )}

      {/* PAYMENT INSTRUCTIONS */}
      {data.company.paymentInstructions && (
        <div className="mb-6 pb-4 border-b border-gray-100">
          <p className="text-[10px] font-semibold uppercase text-gray-400 mb-1 tracking-wider">
            {intl.formatMessage({ id: "invoiceDoc.paymentInfo" })}
          </p>
          <p className="text-gray-600 whitespace-pre-line">{data.company.paymentInstructions}</p>
          {data.company.iban && <p className="text-gray-600">IBAN: {data.company.iban}</p>}
          {data.company.bankName && <p className="text-gray-600">{data.company.bankName}</p>}
        </div>
      )}

      {/* FOOTER */}
      <div className="mt-auto pt-6 text-xs text-gray-400 text-center border-t border-gray-100 print:text-[9px]">
        <p>{data.company.name}</p>
        {data.company.address && (
          <p>{data.company.address}{data.company.municipality ? `, ${data.company.municipality}` : ""}</p>
        )}
        {data.company.vatNumber && <p>{intl.formatMessage({ id: "invoiceDoc.vatNumber" })}: {data.company.vatNumber}</p>}
        {data.company.documentFooter && <p className="mt-1">{data.company.documentFooter}</p>}
        <p className="mt-1">{intl.formatMessage({ id: "invoiceDoc.generatedBy" })}</p>
      </div>
    </div>
  );
}
