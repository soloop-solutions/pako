import { forwardRef, useRef } from "react";
import type { PosBootstrapResponse, TabResponse } from "@pako/shared";
import { Printer } from "lucide-react";
import { useIntl } from "react-intl";

import { FormDialog } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { TabLineState } from "@/lib/pos-enums";
import { printCoupon } from "@/lib/pos-print";

const money = (v: number) => v.toFixed(2);

// docs/POS_PLAN.md §6.2: the pre-bill shown to the table before paying. It is NOT a fiscal coupon
// (that is issued at payment) and says so in large letters. Lines, gross and totals are the tab's
// as the server returned them; nothing is added up here.
export const PreBillReceipt = forwardRef<HTMLDivElement, { tab: TabResponse; boot: PosBootstrapResponse }>(function PreBillReceipt({ tab, boot }, ref) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const lines = tab.lines.filter((l) => l.state === TabLineState.Pending || l.state === TabLineState.Sent);
  return (
    <div ref={ref} className="mx-auto w-[72mm] bg-white p-2 font-mono text-[11px] leading-tight text-black" data-testid="prebill">
      <p className="mb-1 border-2 border-black p-1 text-center text-[12px] font-bold">{t("rest.prebill.banner")}</p>
      {boot.store.receiptHeader && <p className="whitespace-pre-line text-center">{boot.store.receiptHeader}</p>}
      <p className="text-center font-bold">{boot.companyName}</p>
      <p className="text-center">{boot.store.name}{boot.store.address ? `, ${boot.store.address}` : ""}</p>
      <hr className="my-1 border-dashed border-black" />
      <div className="flex justify-between">
        <span>{tab.number}{tab.tableName ? ` · ${tab.tableName}` : ""}</span>
        <span>{intl.formatDate(new Date())} {intl.formatTime(new Date())}</span>
      </div>
      <div className="flex justify-between">
        <span>{t("rest.waiterName", { name: tab.waiterName })}</span>
        {tab.covers > 0 && <span>{t("rest.coversCount", { count: tab.covers })}</span>}
      </div>
      {tab.preBillCount > 1 && <p>{t("rest.prebill.copy", { count: tab.preBillCount })}</p>}
      <hr className="my-1 border-dashed border-black" />
      {lines.map((l) => (
        <div key={l.id} className={l.parentLineId ? "pl-3" : undefined}>
          <div className="flex justify-between gap-2">
            <span>{l.description}</span>
            {!l.parentLineId || l.gross !== 0 ? <span>{money(l.gross)}</span> : null}
          </div>
          {!l.parentLineId && (
            <div className="pl-2">
              {intl.formatNumber(l.quantity)} × {money(l.unitPrice)}
              {l.modifiers ? ` · ${l.modifiers}` : ""}
            </div>
          )}
        </div>
      ))}
      <hr className="my-1 border-dashed border-black" />
      <div className="flex justify-between text-[13px] font-bold">
        <span>{t("till.total")}</span>
        <span>{money(tab.total)}</span>
      </div>
      {/* P5: the whole bill's VAT per letter, as the server split it. */}
      {(tab.billTaxes?.length ?? 0) > 0 && (
        <table className="mt-1 w-full" data-testid="prebill-taxes">
          <thead>
            <tr>
              <th className="text-left font-normal" />
              <th className="text-right font-normal">{t("coupon.taxBase")}</th>
              <th className="text-right font-normal">{t("coupon.tax")}</th>
            </tr>
          </thead>
          <tbody>
            {tab.billTaxes?.map((tx) => (
              <tr key={tx.taxLetter}>
                <td>{tx.taxLetter} {intl.formatNumber(tx.taxRate, { style: "percent", maximumFractionDigits: 2 })}</td>
                <td className="text-right">{money(tx.net)}</td>
                <td className="text-right">{money(tx.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab.paid !== 0 && (
        <>
          <div className="flex justify-between">
            <span>{t("rest.paid")}</span>
            <span>{money(tab.paid)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>{t("rest.due")}</span>
            <span>{money(tab.due)}</span>
          </div>
        </>
      )}
      <hr className="my-1 border-dashed border-black" />
      <p className="text-center font-bold">{t("rest.prebill.banner")}</p>
    </div>
  );
});

export function PreBillDialog({ tab, boot, onClose }: { tab: TabResponse; boot: PosBootstrapResponse; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const ref = useRef<HTMLDivElement>(null);
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("rest.prebill.title")} size="sm">
      <div className="flex flex-col gap-3">
        <div className="max-h-[55vh] overflow-y-auto rounded border">
          <PreBillReceipt ref={ref} tab={tab} boot={boot} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
          <Button autoFocus onClick={() => printCoupon(ref.current)}>
            <Printer className="size-4" /> {t("till.print")}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}
