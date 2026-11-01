import { useMemo, useState } from "react";
import type { PosOrderLineRequest, TabResponse, TabSplitResponse } from "@pako/shared";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Check, Divide, ListChecks, Wallet } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";
import { payable, tabPayLine, type TabPayment } from "@/pages/pos/restaurant/tab-utils";

const money = (v: number | undefined) => (v ?? 0).toFixed(2);

// docs/POS_PLAN.md §6.2: pay all, pay chosen lines, or split equally. What each choice costs is
// always the server's figure — the tab's due, a quote with the tab, or the split's part total.
export function PayTabDialog({ tab, registerId, split, paidParts, onSplit, onPay, onClose }: {
  tab: TabResponse;
  registerId: string;
  split: TabSplitResponse | null;
  paidParts: number[];
  onSplit: (split: TabSplitResponse | null) => void;
  onPay: (payment: TabPayment) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [mode, setMode] = useState<"menu" | "lines" | "split">(split ? "split" : "menu");
  const open = tab.lines.filter(payable);

  function payAll() {
    onPay({ key: `all:${tab.id}:${tab.paid}`, lines: open.map((l) => tabPayLine(l.id, l.remaining)), total: tab.due });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("rest.pay.title", { number: tab.number })} size={mode === "menu" ? "sm" : "md"}>
      {mode === "menu" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">{t("rest.due")}</span>
            <span className="text-3xl font-bold tabular-nums" data-testid="tab-due">{money(tab.due)}</span>
          </div>
          <Button className="h-12 text-lg" disabled={open.length === 0} onClick={payAll}>
            <Wallet className="size-5" /> {t("rest.pay.all")}
          </Button>
          <Button variant="outline" className="h-12" disabled={open.length === 0} onClick={() => setMode("lines")}>
            <ListChecks className="size-5" /> {t("rest.pay.lines")}
          </Button>
          <Button variant="outline" className="h-12" disabled={open.length === 0} onClick={() => setMode("split")}>
            <Divide className="size-5" /> {t("rest.pay.split")}
          </Button>
        </div>
      )}
      {mode === "lines" && <PayLines tab={tab} registerId={registerId} onPay={onPay} onBack={() => setMode("menu")} />}
      {mode === "split" && (
        <SplitParts
          tab={tab}
          split={split}
          paidParts={paidParts}
          onSplit={onSplit}
          onPay={onPay}
          onBack={() => {
            onSplit(null);
            setMode("menu");
          }}
        />
      )}
    </FormDialog>
  );
}

// Lines and quantities chosen by the guest. A combo's choices go with their combo line.
function PayLines({ tab, registerId, onPay, onBack }: {
  tab: TabResponse;
  registerId: string;
  onPay: (payment: TabPayment) => void;
  onBack: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const parents = tab.lines.filter((l) => payable(l) && !l.parentLineId);
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const lines = useMemo(() => {
    const result: PosOrderLineRequest[] = [];
    for (const p of parents) {
      const q = Number(quantities[p.id] ?? "0");
      if (!(q > 0) || q > p.remaining) continue;
      result.push(tabPayLine(p.id, q));
      // The combo's choices (no price of their own) follow the combo line's quantity.
      for (const c of tab.lines.filter((x) => x.parentLineId === p.id && payable(x))) result.push(tabPayLine(c.id, q > c.remaining ? c.remaining : q));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantities, tab]);
  const invalid = parents.some((p) => {
    const raw = quantities[p.id];
    if (raw === undefined || raw.trim() === "") return false;
    const q = Number(raw);
    return !Number.isFinite(q) || q < 0 || q > p.remaining;
  });

  const quote = useQuery({
    queryKey: ["posTabQuote", companyId, registerId, tab.id, lines],
    queryFn: () => apiClient.quotePosBasket(companyId, registerId, { lines, tabId: tab.id }),
    enabled: lines.length > 0 && !invalid,
    placeholderData: keepPreviousData,
  });
  const current = !!quote.data && !quote.isPlaceholderData && !quote.isFetching;

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y rounded-md border text-sm">
        {parents.map((l) => {
          const raw = quantities[l.id] ?? "";
          const all = raw !== "" && Number(raw) === l.remaining;
          return (
            <li key={l.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-1.5">
              <span>
                {l.description}
                {l.modifiers && <span className="block text-xs text-muted-foreground">{l.modifiers}</span>}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("rest.pay.left", { qty: intl.formatNumber(l.remaining) })} · {money(l.remainingGross)}
              </span>
              <Input
                aria-label={t("rest.pay.qtyFor", { item: l.description })}
                type="number"
                min={0}
                max={l.remaining}
                step="any"
                value={raw}
                placeholder="0"
                onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))}
                className="h-7 w-20 text-right tabular-nums"
              />
              <Button
                size="xs"
                variant={all ? "default" : "outline"}
                aria-label={t("rest.pay.whole", { item: l.description })}
                onClick={() => setQuantities((q) => ({ ...q, [l.id]: all ? "" : String(l.remaining) }))}
              >
                <Check className="size-3" />
              </Button>
            </li>
          );
        })}
      </ul>
      {invalid && <p className="text-sm text-destructive">{t("rest.pay.qtyInvalid")}</p>}
      {quote.error && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(quote.error, t("till.saleError"))}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{t("rest.pay.selected")}</span>
        <span className={cn("text-2xl font-bold tabular-nums", !current && "opacity-50")} data-testid="selected-total">
          {lines.length === 0 ? money(0) : quote.data ? money(quote.data.total) : "…"}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" className="mr-auto" onClick={onBack}>{t("rest.combo.back")}</Button>
        <Button
          disabled={lines.length === 0 || invalid || !current || !!quote.error}
          onClick={() => quote.data && onPay({ key: `lines:${tab.id}:${JSON.stringify(lines.map((l) => [l.tabLineId, l.quantity]))}`, lines, total: quote.data.total })}
        >
          {t("till.pay")}
        </Button>
      </div>
    </div>
  );
}

function SplitParts({ tab, split, paidParts, onSplit, onPay, onBack }: {
  tab: TabResponse;
  split: TabSplitResponse | null;
  paidParts: number[];
  onSplit: (split: TabSplitResponse) => void;
  onPay: (payment: TabPayment) => void;
  onBack: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [ways, setWays] = useState(String(split?.ways ?? Math.max(2, tab.covers)));
  const [error, setError] = useState<string | null>(null);
  const load = useMutation({
    mutationFn: (n: number) => apiClient.splitPosTab(activeCompanyId as string, tab.id, n),
    onSuccess: (result) => {
      setError(null);
      onSplit(result);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("till.saleError"))),
  });
  const n = Number(ways);
  const validWays = /^\d{1,2}$/.test(ways.trim()) && n >= 2 && n <= 50;
  // Once a part is paid the split stays as it is: the remaining parts were sized against it.
  const locked = paidParts.length > 0;
  // The next part to pay is the first one not yet paid (comparison of part numbers only).
  const nextPart = split?.parts.find((p) => !paidParts.includes(p.part))?.part;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (validWays && !locked) load.mutate(n);
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="split-ways">{t("rest.split.ways")}</Label>
          <Input id="split-ways" inputMode="numeric" autoFocus={!split} disabled={locked} value={ways} onChange={(e) => setWays(e.target.value)} className="h-9 w-24 text-right tabular-nums" />
        </div>
        <Button type="submit" variant="outline" disabled={!validWays || locked || load.isPending}>{t("rest.split.compute")}</Button>
      </form>
      {split && (
        <ul className="divide-y rounded-md border text-sm" data-testid="split-parts">
          {split.parts.map((p) => {
            const paid = paidParts.includes(p.part);
            return (
              <li key={p.part} className={cn("flex items-center justify-between gap-2 px-3 py-2", paid && "text-muted-foreground line-through")}>
                <span>{t("rest.split.part", { part: p.part, ways: split.ways })}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{money(p.total)}</span>
                  {paid ? (
                    <span className="text-xs no-underline">{t("rest.split.paid")}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={p.part === nextPart ? "default" : "outline"}
                      onClick={() => onPay({
                        key: `split:${tab.id}:${split.ways}:${p.part}`, part: p.part, total: p.total,
                        lines: p.lines.map((l) => tabPayLine(l.tabLineId, l.quantity)),
                      })}
                    >
                      {t("rest.split.payPart", { part: p.part })}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-start">
        <Button variant="outline" disabled={locked} onClick={onBack}>{t("rest.combo.back")}</Button>
      </div>
    </div>
  );
}
