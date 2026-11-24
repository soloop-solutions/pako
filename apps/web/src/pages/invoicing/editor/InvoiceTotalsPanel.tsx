import { useIntl } from "react-intl";
import { formatMoney } from "@/lib/amount";
import type { InvoiceQuoteResponse, TaxDefinitionResponse } from "@pako/shared";

import { cn } from "@/lib/utils";

// The invoice's totals exactly as the server quotes them (POST invoices/quote): before rabat, rabat,
// value excl. VAT, VAT per rate with its base, the total and the total in words. Greyed while a newer
// quote is loading.
export function InvoiceTotalsPanel({
  quote,
  isStale,
  taxes,
  currency,
}: {
  quote: InvoiceQuoteResponse | undefined;
  isStale: boolean;
  taxes: TaxDefinitionResponse[];
  currency: string;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const money = (value: number | undefined) => formatMoney(value);
  const totals = quote?.totals;

  return (
    <section
      className={cn("flex flex-col gap-1 rounded-lg border bg-card p-4 text-sm transition-opacity", isStale && "opacity-60")}
      aria-labelledby="invoice-totals-heading"
      aria-busy={isStale}
      data-testid="invoice-totals"
    >
      <h3 id="invoice-totals-heading" className="mb-1 text-sm font-semibold">{t("invoiceEditor.totalsSection")}</h3>
      {totals && totals.discountAmount !== 0 && (
        <>
          <Row label={t("invoiceDoc.amountBeforeDiscount")} value={money(totals.amountBeforeDiscount)} />
          <Row label={t("invoiceDoc.totalDiscount")} value={`-${money(totals.discountAmount)}`} />
        </>
      )}
      <Row label={t("invoiceDoc.subtotal")} value={money(totals?.netAmount)} />
      {quote?.taxBreakdown.map((row) => {
        const tax = taxes.find((x) => x.id === row.taxDefinitionId);
        return (
          <Row
            key={row.taxDefinitionId}
            muted
            label={intl.formatMessage({ id: "invoiceEditor.vatOnBase" }, { tax: tax?.name ?? "", base: money(row.netAmount) })}
            value={money(row.taxAmount)}
          />
        );
      })}
      <Row label={t("invoiceDoc.totalVat")} value={money(totals?.taxAmount)} />
      <div className="mt-2 flex items-baseline justify-between border-t pt-2 text-base font-bold">
        <span>{t("invoiceDoc.grandTotal")}</span>
        <span className="tabular-nums" data-testid="invoice-grand-total">{`${money(totals?.grossAmount)} ${currency}`}</span>
      </div>
      {quote?.totalInWords && (
        <p className="text-xs text-muted-foreground">
          {t("invoiceDoc.inWords")}: <span className="italic">{quote.totalInWords}</span>
        </p>
      )}
    </section>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", muted && "text-xs text-muted-foreground")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
