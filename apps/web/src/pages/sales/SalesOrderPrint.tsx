import { forwardRef } from "react";
import type { SalesOrderResponse, TaxDefinitionResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { formatAmount } from "@/lib/payroll-enums";
import { SalesOrderState, formatIsoDate } from "@/lib/sales-order-enums";

// docs/POS_PLAN.md P6 — the A4 quote / order confirmation sent to the customer. Printed through
// lib/print.ts (an isolated iframe), so it is plain markup with print-friendly colours. Every
// amount is the API's.
export const SalesOrderPrint = forwardRef<HTMLDivElement, {
  order: SalesOrderResponse; companyName: string; taxes: TaxDefinitionResponse[];
}>(function SalesOrderPrint({ order, companyName, taxes }, ref) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const isQuote = order.state < SalesOrderState.Confirmed;
  const number = isQuote ? order.quoteNumber : order.number;
  const qty = (v: number) => intl.formatNumber(v);
  const price = (v: number) => intl.formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return (
    <div ref={ref} className="flex flex-col gap-5 bg-white p-2 text-[12px] text-black">
      <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
        <div>
          <p className="text-lg font-bold">{companyName}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{t(isQuote ? "so.print.quote" : "so.print.order")}</p>
          <p>{number ?? t("stock.doc.draftNumber")}</p>
          <p>{t("so.col.date")}: {formatIsoDate(intl, order.date)}</p>
          {isQuote && order.validUntil && <p>{t("so.validUntil")}: {formatIsoDate(intl, order.validUntil)}</p>}
          {order.deliveryDate && <p>{t("so.col.deliveryDate")}: {formatIsoDate(intl, order.deliveryDate)}</p>}
        </div>
      </header>
      <section className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase text-neutral-600">{t("so.col.customer")}</p>
          <p className="font-semibold">{order.partnerName}</p>
          {order.deliveryAddress && <p className="whitespace-pre-line">{order.deliveryAddress}</p>}
        </div>
        {order.customerReference && (
          <div>
            <p className="text-[10px] uppercase text-neutral-600">{t("so.customerReference")}</p>
            <p>{order.customerReference}</p>
          </div>
        )}
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">#</th>
            <th className="py-1">{t("so.col.description")}</th>
            <th className="py-1 text-right">{t("stock.col.quantity")}</th>
            <th className="py-1">{t("price.col.unit")}</th>
            <th className="py-1 text-right">{t("so.col.price")}</th>
            <th className="py-1 text-right">{t("so.col.discount")}</th>
            <th className="py-1">{t("so.col.vat")}</th>
            <th className="py-1 text-right">{t("so.col.gross")}</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={l.id} className="border-b border-neutral-300">
              <td className="py-1">{i + 1}</td>
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right tabular-nums">{qty(l.quantity)}</td>
              <td className="py-1">{l.unitName ?? ""}</td>
              <td className="py-1 text-right tabular-nums">{price(l.unitPrice)}</td>
              <td className="py-1 text-right tabular-nums">{l.discountPercent ? `${qty(l.discountPercent)}%` : ""}</td>
              <td className="py-1">{taxes.find((tx) => tx.id === l.taxDefinitionId)?.code ?? ""}</td>
              <td className="py-1 text-right tabular-nums">{formatAmount(l.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="ml-auto flex w-64 flex-col gap-1">
        <div className="flex justify-between"><span>{t("so.net")}</span><span className="tabular-nums">{formatAmount(order.net)}</span></div>
        <div className="flex justify-between"><span>{t("so.vat")}</span><span className="tabular-nums">{formatAmount(order.vat)}</span></div>
        <div className="flex justify-between border-t border-black pt-1 font-bold"><span>{t("so.total")}</span><span className="tabular-nums">{formatAmount(order.total)}</span></div>
      </section>
      {isQuote && order.validUntil && <p>{intl.formatMessage({ id: "so.print.validity" }, { date: formatIsoDate(intl, order.validUntil) })}</p>}
      {order.notes && <p className="whitespace-pre-line">{order.notes}</p>}
    </div>
  );
});
