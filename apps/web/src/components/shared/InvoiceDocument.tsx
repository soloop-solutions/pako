import { useIntl } from "react-intl";

// ---------------------------------------------------------------------------
// InvoiceDocument — the printable A4-portrait sales document (invoice, credit/debit note, down
// payment, sales return, proforma). It mirrors the server PDF (InvoicePdfRenderer.cs) block for block:
// seller header, boxed buyer, dates, a 13-column line table, VAT per rate with its base, totals, the
// total in words, payment details and the "Dorëzoi / Pranoi / Vula" signature boxes.
//
// Every amount comes from the server: the single-invoice GET for a saved document, POST
// invoices/quote for the unsaved preview. This component never computes money; a figure the caller
// does not have yet renders as "—".
// ---------------------------------------------------------------------------

export interface InvoiceLineData {
  itemCode?: string;
  description: string;
  unitName?: string;
  quantity: number;
  discountPercent: number;
  /** e.g. "18%"; undefined for a line without a tax code */
  taxRateLabel?: string;
  unitPriceNet?: number;
  unitPriceGross?: number;
  discountAmount?: number;
  net?: number;
  taxAmount?: number;
  gross?: number;
}

/** Server-computed document totals. */
export interface InvoiceTotalsData {
  amountBeforeDiscount: number;
  discountAmount: number;
  net: number;
  tax: number;
  gross: number;
}

export interface InvoiceVatRow {
  label: string;
  base: number;
  vat: number;
  gross?: number;
}

export interface InvoiceDocumentData {
  /** 0 Invoice, 1 CreditNote, 2 DebitNote, 3 DownPayment, 4 SalesReturn, 5 Proforma */
  documentType: number;
  /** Official number (posted) or undefined (draft/unsaved) */
  invoiceNumber?: string;
  /** "Draft" | "Posted" | "Cancelled" | "Preview" (unsaved) */
  state: string;
  issueDate: string;
  dueDate: string;
  /** 0 = GrossInclusive, 1 = NetExclusive */
  priceMode: number;
  internalNotes?: string;
  paymentTermDays?: number;

  company: {
    name: string;
    legalName?: string;
    legalForm?: string;
    vatNumber?: string;
    fiscalNumber?: string;
    businessNumber?: string;
    address?: string;
    postalCode?: string;
    municipality?: string;
    country?: string;
    phone?: string;
    email?: string;
    website?: string;
    iban?: string;
    bankName?: string;
    bankAccountHolder?: string;
    swiftBic?: string;
    /** Every bank account the company lists (default first); the single fields above stand in when empty */
    bankAccounts?: { bankName: string; accountHolder?: string; iban?: string; swiftBic?: string }[];
    paymentInstructions?: string;
    documentFooter?: string;
    logoUrl?: string;
    stampUrl?: string;
  };

  customer: {
    name: string;
    /** NUI */
    taxNumber?: string;
    vatNumber?: string;
    /** Personal number of a natural person */
    fiscalNumber?: string;
    contactPerson?: string;
    streetAddress?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    phone?: string;
    email?: string;
  };

  lines: InvoiceLineData[];
  originalDocumentNumber?: string;
  currency: string;
  totals?: InvoiceTotalsData;
  vatRows?: InvoiceVatRow[];
  totalInWords?: string;
}

const DOCUMENT_TYPE_TITLE_KEYS: Record<number, string> = {
  0: "invoiceDoc.title.invoice",
  1: "invoiceDoc.title.creditNote",
  2: "invoiceDoc.title.debitNote",
  3: "invoiceDoc.title.downPayment",
  4: "invoiceDoc.title.salesReturn",
  5: "invoiceDoc.title.proforma",
};

const money = (value: number | undefined) => (value == null ? "—" : value.toFixed(2));

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return dateStr;
}

const join = (separator: string, ...parts: (string | undefined | null | false)[]) =>
  parts.filter((part): part is string => !!part && part.trim() !== "").join(separator);

export function InvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const captioned = (id: string, value?: string) => (value ? `${t(id)}: ${value}` : undefined);

  const isDraft = data.state === "Draft" || data.state === "Preview";
  const titleKey = DOCUMENT_TYPE_TITLE_KEYS[data.documentType] ?? "invoiceDoc.title.invoice";
  const { company, customer, totals } = data;
  const banks = company.bankAccounts && company.bankAccounts.length > 0
    ? company.bankAccounts
    : company.bankName || company.iban
      ? [{ bankName: company.bankName ?? "", iban: company.iban, swiftBic: company.swiftBic, accountHolder: company.bankAccountHolder }]
      : [];
  const hasDiscount = (totals?.discountAmount ?? 0) !== 0;

  const companyIds = join(" · ",
    captioned("invoiceDoc.businessNumber", company.businessNumber),
    captioned("invoiceDoc.fiscalNumber", company.fiscalNumber),
    captioned("invoiceDoc.vatNumber", company.vatNumber));
  const customerIds = join(" · ",
    captioned("invoiceDoc.nui", customer.taxNumber),
    captioned("invoiceDoc.vatNumber", customer.vatNumber),
    captioned("invoiceDoc.personalNumber", customer.fiscalNumber));

  const th = "py-1.5 pr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 align-bottom print:text-[8px]";
  const td = "py-1 pr-1 align-top tabular-nums";

  return (
    <div className="invoice-document relative mx-auto w-full bg-white text-black px-8 py-10 font-[system-ui,sans-serif] text-[12px] leading-[1.5] print:w-[210mm] print:min-h-[297mm] print:p-[12mm] print:text-[10px]">
      {isDraft && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-6xl font-bold text-gray-200 rotate-[-35deg] select-none tracking-widest print:text-[80px]">
            {t(data.state === "Preview" ? "invoiceDoc.watermark.preview" : "invoiceDoc.watermark.draft")}
          </span>
        </div>
      )}

      {/* SELLER + TITLE */}
      <div className="mb-4 flex items-start justify-between gap-6 border-b-2 border-gray-800 pb-3">
        <div className="flex items-start gap-3">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt="" className="max-h-16 max-w-28 object-contain" />
          ) : (
            <div className="flex size-14 items-center justify-center bg-gray-800 text-xl font-bold text-white">
              {company.name.slice(0, 1).toUpperCase() || "?"}
            </div>
          )}
          <div className="text-gray-600">
            <p className="text-base font-bold text-gray-900">{join(" ", company.name, company.legalForm)}</p>
            {company.legalName && <p>{company.legalName}</p>}
            {join(", ", company.address, join(" ", company.postalCode, company.municipality), company.country) && (
              <p>{join(", ", company.address, join(" ", company.postalCode, company.municipality), company.country)}</p>
            )}
            {companyIds && <p>{companyIds}</p>}
            {join(" · ", captioned("invoiceDoc.phone", company.phone), company.email, company.website) && (
              <p>{join(" · ", captioned("invoiceDoc.phone", company.phone), company.email, company.website)}</p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <h1 className="text-[22px] font-bold uppercase text-gray-800">{t(titleKey)}</h1>
          <p className="text-sm font-semibold">
            {data.invoiceNumber ? `${t("invoiceDoc.number")}: ${data.invoiceNumber}` : t("invoiceDoc.draftReference")}
          </p>
        </div>
      </div>

      {/* BUYER + DATES */}
      <div className="mb-4 flex gap-6">
        <div className="flex-1 rounded-sm border border-gray-200 bg-gray-50 p-3 text-gray-600">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t("invoiceDoc.buyer")}</p>
          <p className="text-sm font-bold text-gray-900">{customer.name}</p>
          {customer.contactPerson && <p>{captioned("invoiceDoc.contactPerson", customer.contactPerson)}</p>}
          {join(", ", customer.streetAddress, join(" ", customer.postalCode, customer.city), customer.country) && (
            <p>{join(", ", customer.streetAddress, join(" ", customer.postalCode, customer.city), customer.country)}</p>
          )}
          {customerIds && <p>{customerIds}</p>}
          {join(" · ", captioned("invoiceDoc.phone", customer.phone), customer.email) && (
            <p>{join(" · ", captioned("invoiceDoc.phone", customer.phone), customer.email)}</p>
          )}
        </div>
        <dl className="grid w-56 shrink-0 grid-cols-[auto_1fr] content-start gap-x-3 gap-y-0.5">
          <dt className="text-gray-500">{t("invoiceDoc.issueDate")}</dt>
          <dd className="text-right font-medium">{formatDate(data.issueDate)}</dd>
          <dt className="text-gray-500">{t("invoiceDoc.dueDate")}</dt>
          <dd className="text-right font-medium">{formatDate(data.dueDate)}</dd>
          {data.paymentTermDays != null && data.paymentTermDays > 0 && (
            <>
              <dt className="text-gray-500">{t("invoiceDoc.paymentTerms")}</dt>
              <dd className="text-right font-medium">{intl.formatMessage({ id: "invoiceDoc.netDays" }, { days: data.paymentTermDays })}</dd>
            </>
          )}
          <dt className="text-gray-500">{t("invoiceDoc.currency")}</dt>
          <dd className="text-right font-medium">{data.currency}</dd>
          {data.originalDocumentNumber && (
            <>
              <dt className="text-gray-500">{t("invoiceDoc.originalRef")}</dt>
              <dd className="text-right font-medium">{data.originalDocumentNumber}</dd>
            </>
          )}
        </dl>
      </div>

      {/* LINES — every column always shown, as on the PDF */}
      <table className="mb-4 w-full border-collapse text-[11px] print:text-[8.5px]">
        <thead>
          <tr className="border-b-2 border-gray-800">
            <th className={`${th} w-6 text-left`}>{t("invoiceDoc.col.no")}</th>
            <th className={`${th} w-12 text-left`}>{t("invoiceDoc.col.code")}</th>
            <th className={`${th} text-left`}>{t("invoiceDoc.col.description")}</th>
            <th className={`${th} w-10 text-left`}>{t("invoiceDoc.col.unit")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.qty")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.unitPriceExclVat")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.unitPriceInclVat")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.discountPercent")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.discountAmount")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.net")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.vatRate")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.vatValue")}</th>
            <th className={`${th} text-right`}>{t("invoiceDoc.col.total")}</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, index) => (
            <tr key={index} className="border-b border-gray-100">
              <td className={`${td} text-gray-400`}>{index + 1}</td>
              <td className={td}>{line.itemCode ?? ""}</td>
              <td className={`${td} text-gray-800`}>{line.description || "—"}</td>
              <td className={td}>{line.unitName ?? ""}</td>
              <td className={`${td} text-right`}>{line.quantity}</td>
              <td className={`${td} text-right`}>{money(line.unitPriceNet)}</td>
              <td className={`${td} text-right`}>{money(line.unitPriceGross)}</td>
              <td className={`${td} text-right`}>{line.discountPercent > 0 ? `${line.discountPercent}%` : "—"}</td>
              <td className={`${td} text-right`}>{line.discountAmount ? money(line.discountAmount) : "—"}</td>
              <td className={`${td} text-right`}>{money(line.net)}</td>
              <td className={`${td} text-right text-gray-500`}>{line.taxRateLabel ?? "—"}</td>
              <td className={`${td} text-right`}>{money(line.taxAmount)}</td>
              <td className={`${td} text-right font-semibold`}>{money(line.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* VAT TABLE + TOTALS */}
      <div className="mb-3 flex items-start gap-6">
        <div className="flex-1">
          {data.vatRows && data.vatRows.length > 0 && (
            <table className="w-full border-collapse text-[11px] print:text-[9px]">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className={`${th} text-left`}>{t("invoiceDoc.vatTable.rate")}</th>
                  <th className={`${th} text-right`}>{t("invoiceDoc.vatTable.base")}</th>
                  <th className={`${th} text-right`}>{t("invoiceDoc.vatTable.vat")}</th>
                  <th className={`${th} text-right`}>{t("invoiceDoc.vatTable.total")}</th>
                </tr>
              </thead>
              <tbody>
                {data.vatRows.map((row) => (
                  <tr key={row.label} className="border-b border-gray-100">
                    <td className={td}>{row.label}</td>
                    <td className={`${td} text-right`}>{money(row.base)}</td>
                    <td className={`${td} text-right`}>{money(row.vat)}</td>
                    <td className={`${td} text-right`}>{money(row.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="w-64 shrink-0">
          {hasDiscount && (
            <>
              <TotalRow label={t("invoiceDoc.amountBeforeDiscount")} value={money(totals?.amountBeforeDiscount)} />
              <TotalRow label={t("invoiceDoc.totalDiscount")} value={`-${money(totals?.discountAmount)}`} />
            </>
          )}
          <TotalRow label={t("invoiceDoc.subtotal")} value={money(totals?.net)} />
          <TotalRow label={t("invoiceDoc.totalVat")} value={money(totals?.tax)} />
          <div className="mt-1 flex justify-between bg-gray-800 px-2 py-1.5 text-sm font-bold text-white">
            <span>{t("invoiceDoc.grandTotal")}</span>
            <span className="tabular-nums">{`${money(totals?.gross)} ${data.currency}`}</span>
          </div>
        </div>
      </div>

      {data.totalInWords && (
        <p className="mb-4">
          <span className="text-gray-500">{t("invoiceDoc.inWords")}: </span>
          <span className="italic">{data.totalInWords}</span>
        </p>
      )}

      {data.internalNotes && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t("invoiceDoc.notes")}</p>
          <p className="whitespace-pre-line text-gray-700">{data.internalNotes}</p>
        </div>
      )}

      {(company.paymentInstructions || banks.length > 0) && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t("invoiceDoc.paymentInfo")}</p>
          {company.paymentInstructions && <p className="whitespace-pre-line text-gray-700">{company.paymentInstructions}</p>}
          {banks.map((bank, index) => (
            <p key={index} className="text-gray-700">
              {join(" · ",
                bank.bankName,
                bank.iban ? `IBAN: ${bank.iban}` : undefined,
                bank.swiftBic ? `SWIFT/BIC: ${bank.swiftBic}` : undefined,
                captioned("invoiceDoc.accountHolder", bank.accountHolder))}
            </p>
          ))}
        </div>
      )}

      {/* DELIVERED BY / RECEIVED BY / STAMP */}
      <div className="mt-8 grid grid-cols-3 gap-6 break-inside-avoid">
        {[
          { key: "invoiceDoc.deliveredBy", image: undefined },
          { key: "invoiceDoc.receivedBy", image: undefined },
          { key: "invoiceDoc.stampAndSignature", image: company.stampUrl },
        ].map((box) => (
          <div key={box.key} className="text-center">
            <div className="flex h-20 items-center justify-center">
              {box.image && <img src={box.image} alt="" className="max-h-20 max-w-full object-contain" />}
            </div>
            <p className="border-t border-gray-800 pt-1 text-xs text-gray-500">{t(box.key)}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-gray-100 pt-3 text-center text-xs text-gray-400 print:text-[8px]">
        {company.documentFooter && <p>{company.documentFooter}</p>}
        <p>{t("invoiceDoc.generatedBy")}</p>
      </div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5 text-gray-700">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
