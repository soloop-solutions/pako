import { useState, type ReactNode } from "react";
import type { TabResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TabLineState, tabLineStateKey } from "@/lib/pos-enums";
import { cn } from "@/lib/utils";
import { money } from "@/pages/pos/hotel/hotel-utils";
import { payable } from "@/pages/pos/restaurant/tab-utils";

// docs/POS_PLAN.md §6.4–6.5 / P5: components shared by the hotel, events and ticketing pages.

// ---- A folio or an event bill, read-only: every figure is the server's ----

export function FolioView({ tab, selectable = false, selected = [], onToggle }: {
  tab: TabResponse;
  /** Lines still to pay can be ticked (billing them to a company). */
  selectable?: boolean;
  selected?: string[];
  onToggle?: (lineId: string) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const lines = tab.lines.filter((l) => !l.parentLineId);
  return (
    <div className="flex flex-col gap-2 rounded-md border" data-testid="folio">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-sm">
        <span className="font-medium">{tab.number}{tab.name ? ` · ${tab.name}` : ""}</span>
        <span className="text-xs text-muted-foreground">{t("hotel.folio.lines", { count: lines.length })}</span>
      </div>
      {lines.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{t("hotel.folio.empty")}</p>
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto">
          {lines.map((l) => {
            const voided = l.state === TabLineState.Voided;
            const canTick = selectable && payable(l);
            return (
              <li key={l.id} className={cn("flex items-start gap-2 px-3 py-1 text-sm", voided && "text-muted-foreground")} data-testid="folio-line">
                {selectable && (
                  <Checkbox
                    className="mt-1"
                    aria-label={t("hotel.folio.select", { item: l.description })}
                    disabled={!canTick}
                    checked={selected.includes(l.id)}
                    onChange={() => onToggle?.(l.id)}
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("flex flex-wrap items-center gap-1", voided && "line-through")}>
                    {l.description}
                    {l.paidQuantity > 0 && <Badge variant="success">{t("rest.line.paid", { qty: intl.formatNumber(l.paidQuantity) })}</Badge>}
                    {voided && <Badge variant="cancelled">{t(`rest.line.${tabLineStateKey(l.state)}`)}</Badge>}
                  </span>
                  {l.note && <span className="text-xs text-muted-foreground">{l.note}</span>}
                </span>
                <span className="flex flex-col items-end tabular-nums">
                  <span className={cn("font-medium", voided && "line-through")}>{money(l.gross)}</span>
                  <span className="text-xs text-muted-foreground">{intl.formatNumber(l.quantity)} × {money(l.unitPrice)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-0.5 border-t px-3 py-2 text-sm tabular-nums">
        {(tab.billTaxes ?? tab.taxes).map((x) => (
          <div key={x.taxLetter} className="flex justify-between text-xs text-muted-foreground">
            <span>{t("till.vat")} {x.taxLetter} {intl.formatNumber(x.taxRate, { style: "percent", maximumFractionDigits: 2 })}</span>
            <span>{money(x.tax)}</span>
          </div>
        ))}
        <div className="flex justify-between">
          <span>{t("till.total")}</span>
          <span>{money(tab.total)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t("rest.paid")}</span>
          <span>{money(tab.paid)}</span>
        </div>
        <div className="flex justify-between text-base font-bold">
          <span>{t("rest.due")}</span>
          <span data-testid="folio-due">{money(tab.due)}</span>
        </div>
      </div>
    </div>
  );
}

// ---- Small pieces ----

export function Field({ id, label, children, className }: { id?: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** A yes/no question before something that cannot be undone (cancel, no-show). */
export function ConfirmDialog({ title, body, confirm, onConfirm, onClose, busy }: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const intl = useIntl();
  return (
    <FormDialog open onOpenChange={(o) => !o && !busy && onClose()} title={title} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm">{body}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{intl.formatMessage({ id: "common.cancel" })}</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>{confirm}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

/** The deposit card's number, to load at the till as a gift-card sale. */
export function DepositCardNote({ number, deposited }: { number: string | undefined; deposited: number }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [copied, setCopied] = useState(false);
  if (!number) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm" data-testid="deposit-card">
      <span>{t("hotel.deposit.card")}</span>
      <span className="font-mono text-base font-bold tracking-wider">{number}</span>
      <span className="text-muted-foreground tabular-nums">{t("hotel.deposit.balance", { amount: money(deposited) })}</span>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(number).then(() => setCopied(true), () => undefined);
        }}
      >
        {t(copied ? "hotel.deposit.copied" : "hotel.deposit.copy")}
      </Button>
      <span className="basis-full text-xs text-muted-foreground">{t("hotel.deposit.hint")}</span>
    </div>
  );
}
