import { forwardRef } from "react";
import type { StockDocumentResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { formatIsoDate } from "@/lib/sales-order-enums";
import { StockDocumentState, StockDocumentType, stockDocumentTypeKey } from "@/lib/stock-enums";

// A stock document on A4 (a delivery note goes with the goods and is signed by both sides).
// Printed through lib/print.ts. Quantities only; no costs on paper that leaves the company.
export const StockDocumentPrint = forwardRef<HTMLDivElement, { document: StockDocumentResponse; companyName: string }>(
  function StockDocumentPrint({ document, companyName }, ref) {
    const intl = useIntl();
    const t = (id: string) => intl.formatMessage({ id });
    const isDelivery = document.type === StockDocumentType.Delivery;
    return (
      <div ref={ref} className="flex flex-col gap-5 bg-white p-2 text-[12px] text-black">
        <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
          <p className="text-lg font-bold">{companyName}</p>
          <div className="text-right">
            <p className="text-lg font-bold">{t(`stock.doc.type.${stockDocumentTypeKey(document.type)}`)}</p>
            <p>{document.state === StockDocumentState.Posted ? document.number : t("stock.doc.draft")}</p>
            <p>{t("stock.card.date")}: {formatIsoDate(intl, document.date)}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase text-neutral-600">{t(document.destinationWarehouseName ? "stock.doc.from" : "stock.warehouse")}</p>
            <p>{document.warehouseName}</p>
            {document.destinationWarehouseName && (
              <>
                <p className="mt-2 text-[10px] uppercase text-neutral-600">{t("stock.doc.to")}</p>
                <p>{document.destinationWarehouseName}</p>
              </>
            )}
          </div>
          {document.partnerName && (
            <div>
              <p className="text-[10px] uppercase text-neutral-600">{t(isDelivery ? "so.col.customer" : "po.col.vendor")}</p>
              <p className="font-semibold">{document.partnerName}</p>
            </div>
          )}
        </section>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1">#</th>
              <th className="py-1">{t("stock.col.code")}</th>
              <th className="py-1">{t("stock.col.item")}</th>
              <th className="py-1 text-right">{t("stock.col.quantity")}</th>
              <th className="py-1">{t("price.col.unit")}</th>
              <th className="py-1">{t("stock.doc.note")}</th>
            </tr>
          </thead>
          <tbody>
            {document.lines.map((l, i) => (
              <tr key={l.id} className="border-b border-neutral-300">
                <td className="py-1">{i + 1}</td>
                <td className="py-1">{l.itemCode}</td>
                <td className="py-1">{l.itemName}{l.lotNumber ? ` · ${l.lotNumber}` : ""}</td>
                <td className="py-1 text-right tabular-nums">{intl.formatNumber(l.quantity)}</td>
                <td className="py-1">{l.unit}</td>
                <td className="py-1">{l.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {document.notes && <p className="whitespace-pre-line">{document.notes}</p>}
        <footer className="mt-10 grid grid-cols-2 gap-10">
          <div className="border-t border-black pt-1 text-center">{t("dist.print.handedOver")}</div>
          <div className="border-t border-black pt-1 text-center">{t("dist.print.received")}</div>
        </footer>
      </div>
    );
  },
);
