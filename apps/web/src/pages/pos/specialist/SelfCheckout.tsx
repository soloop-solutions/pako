import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { PosBootstrapResponse, PosCatalogItemResponse, PosOrderLineRequest, PosOrderResponse } from "@pako/shared";
import { ApiException } from "@pako/shared";
import { CreditCard, Lock, Minus, Plus, UserRound, X } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { PaymentMethodKind, PosOrderKind } from "@/lib/pos-enums";
import { cn } from "@/lib/utils";
import { CloseSessionDialog, DoneDialog, ValuePrompt } from "@/pages/pos/Till";
import { AttendantPinDialog } from "@/pages/pos/specialist/TillSpecialist";
import { money } from "@/pages/pos/specialist/specialist-utils";

interface Line {
  key: string;
  item: PosCatalogItemResponse;
  quantity: number;
  /** Weighed: its own line, the weight typed. */
  weighed?: boolean;
  /** An age-restricted item: the attendant confirmed the customer's age with their PIN. */
  ageVerified?: boolean;
  /** From a GS1 code. */
  lot?: string;
  serial?: string;
}

const needsAttendant = (l: Line) => (l.item.minimumAge ?? 0) > 0 && !l.ageVerified;

const toRequestLine = (l: Line): PosOrderLineRequest => ({
  itemId: l.item.id,
  description: l.item.name,
  quantity: l.quantity,
  unitPrice: l.item.price as number,
  taxDefinitionId: l.item.taxDefinitionId,
  discountAmount: 0,
  ...(l.ageVerified ? { ageVerified: true } : {}),
  ...(l.lot ? { lotNumber: l.lot } : {}),
  ...(l.serial ? { serialNumber: l.serial } : {}),
});

// docs/POS_PLAN.md P7: a self-checkout lane. The customer scans, sees the server's total and pays
// by card; there are no returns, discounts or cash here (the API refuses them on this profile).
// An age-restricted item waits for the attendant, who confirms the age with their PIN.
export function SelfCheckoutBody({ boot, sessionId, catalog }: { boot: PosBootstrapResponse; sessionId: string; catalog: PosCatalogItemResponse[] }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const searchRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [basket, setBasket] = useState<Line[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [weigh, setWeigh] = useState<PosCatalogItemResponse | null>(null);
  const [attendantFor, setAttendantFor] = useState<Line | null>(null);
  const [closing, setClosing] = useState<"pin" | "dialog" | null>(null);
  const [done, setDone] = useState<PosOrderResponse | null>(null);
  const [saleUuid, setSaleUuid] = useState(() => crypto.randomUUID());
  const card = boot.tenders.find((x) => x.kind === PaymentMethodKind.Card);

  const waiting = basket.some(needsAttendant);
  const lines = useMemo(() => basket.map(toRequestLine), [basket]);
  // Nothing is priced while an item waits for the attendant (the server refuses an unchecked age).
  const quote = useQuery({
    queryKey: ["posQuote", companyId, boot.register.id, lines],
    queryFn: () => apiClient.quotePosBasket(companyId, boot.register.id, { lines }),
    enabled: basket.length > 0 && !waiting,
    placeholderData: keepPreviousData,
  });
  const q = quote.data;
  const quoteCurrent = !!q && !quote.isPlaceholderData && !quote.isFetching;

  const pay = useMutation({
    mutationFn: () =>
      apiClient.submitPosOrder(companyId, {
        clientUuid: saleUuid, sessionId, kind: PosOrderKind.Sale, orderedAt: new Date().toISOString(), lines,
        payments: [{ paymentMethodId: (card as { id: string }).id, amount: (q as { total: number }).total }], createdOffline: false,
      }),
    onSuccess: (order) => {
      setBasket([]);
      setSaleUuid(crypto.randomUUID());
      setNotice(null);
      setDone(order);
    },
    onError: (err: unknown) => setNotice(getApiErrorMessage(err, t("till.saleError"))),
  });

  useEffect(() => {
    if (!weigh && !attendantFor && !closing && !done) searchRef.current?.focus();
  }, [weigh, attendantFor, closing, done]);

  const found = useMemo(() => {
    const typed = term.trim().toLowerCase();
    if (typed.length < 2 || /^\d+$/.test(typed)) return [];
    return catalog.filter((i) => i.price != null && i.name.toLowerCase().includes(typed)).slice(0, 12);
  }, [catalog, term]);

  function add(item: PosCatalogItemResponse, extra: { quantity?: number; lot?: string; serial?: string } = {}) {
    setTerm("");
    setNotice(null);
    if (item.price == null) {
      setNotice(t("till.noPrice", { item: item.name }));
      return;
    }
    // What needs a person — a typed price, a serial number — is sold at a staffed till.
    if (item.openPrice || (item.trackSerials && !extra.serial)) {
      setNotice(t("spec.self.staffedOnly", { item: item.name }));
      return;
    }
    if (item.sellByWeight && extra.quantity == null) {
      setWeigh(item);
      return;
    }
    setBasket((all) => {
      const single = item.sellByWeight || extra.quantity != null || !!extra.lot || !!extra.serial;
      const same = single ? undefined : all.find((l) => l.item.id === item.id && !l.weighed && !l.lot && !l.serial);
      if (same) return all.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      return [...all, { key: crypto.randomUUID(), item, quantity: extra.quantity ?? 1, weighed: single, ...(extra.lot ? { lot: extra.lot } : {}), ...(extra.serial ? { serial: extra.serial } : {}) }];
    });
  }

  async function scan(typed: string) {
    try {
      const hit = await apiClient.scanPosCode(companyId, boot.register.id, typed);
      add(hit.item, {
        quantity: hit.quantity ?? undefined, ...(hit.lotNumber ? { lot: hit.lotNumber } : {}), ...(hit.serialNumber ? { serial: hit.serialNumber } : {}),
      });
    } catch (err) {
      setTerm("");
      if (err instanceof ApiException && err.status === 404) setNotice(t("till.notFound", { term: typed }));
      else setNotice(t("till.scanError", { term: typed, error: getApiErrorMessage(err, t("till.saleError")) }));
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const typed = term.trim();
    if (!typed) return;
    const exact = catalog.find((i) => i.barcodes.includes(typed) || String(i.code) === typed);
    if (exact) add(exact);
    else if (found.length === 1) add(found[0]);
    else void scan(typed);
  }

  const setQuantity = (key: string, quantity: number) =>
    setBasket((all) => (quantity <= 0 ? all.filter((l) => l.key !== key) : all.map((l) => (l.key === key ? { ...l, quantity } : l))));

  const canPay = !!card && basket.length > 0 && !waiting && quoteCurrent && !quote.error && !pay.isPending;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_32rem]" data-testid="self-checkout">
      <section className="flex min-h-0 flex-col gap-4 p-6">
        <h2 className="text-3xl font-bold">{t("spec.self.welcome")}</h2>
        <p className="text-lg text-muted-foreground">{t("spec.self.scanHint")}</p>
        <Input
          ref={searchRef}
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKey}
          aria-label={t("spec.self.scan")}
          placeholder={t("spec.self.scan")}
          className="h-16 text-2xl"
        />
        {notice && (
          <Alert variant="destructive">
            <AlertDescription className="text-lg">{notice}</AlertDescription>
          </Alert>
        )}
        {!card && (
          <Alert variant="destructive">
            <AlertDescription>{t("spec.self.noCard")}</AlertDescription>
          </Alert>
        )}
        <div className="grid auto-rows-min grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {found.map((item) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(item)}
              className="flex min-h-24 flex-col justify-between rounded-lg border p-3 text-left text-lg hover:bg-accent"
            >
              <span className="font-medium">{item.name}</span>
              <span className="self-end font-semibold tabular-nums">{money(item.price)}</span>
            </button>
          ))}
        </div>
        <div className="mt-auto flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setClosing("pin")} disabled={basket.length > 0}>
            <Lock className="size-4" /> {t("spec.self.closeLane")}
          </Button>
        </div>
      </section>

      <section className="flex min-h-0 flex-col border-l">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {basket.length === 0 ? (
            <p className="p-8 text-center text-lg text-muted-foreground">{t("till.basket.empty")}</p>
          ) : (
            <ul className="divide-y">
              {basket.map((l, i) => (
                <li key={l.key} className={cn("flex flex-col gap-2 px-4 py-3", needsAttendant(l) && "bg-amber-50 dark:bg-amber-950/30")} data-testid="self-line">
                  <div className="flex items-start justify-between gap-2 text-lg">
                    <span className="font-medium">{l.item.name}</span>
                    <span className="font-semibold tabular-nums">{quoteCurrent && q?.lines[i] ? money(q.lines[i].gross) : "…"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {l.weighed ? (
                      <span className="text-muted-foreground tabular-nums">{intl.formatNumber(l.quantity)} {l.item.unit} × {money(l.item.price)}</span>
                    ) : (
                      <>
                        <Button size="icon" variant="outline" className="size-11" aria-label="−1" onClick={() => setQuantity(l.key, l.quantity - 1)}>
                          <Minus className="size-5" />
                        </Button>
                        <span className="w-10 text-center text-lg tabular-nums">{intl.formatNumber(l.quantity)}</span>
                        <Button size="icon" variant="outline" className="size-11" aria-label="+1" onClick={() => setQuantity(l.key, l.quantity + 1)}>
                          <Plus className="size-5" />
                        </Button>
                        <span className="text-muted-foreground tabular-nums">× {money(l.item.price)}</span>
                      </>
                    )}
                    {l.ageVerified && <Badge variant="outline">{t("till.ageVerified")}</Badge>}
                    {needsAttendant(l) && (
                      <Button className="ml-auto h-11" variant="destructive" onClick={() => setAttendantFor(l)}>
                        <UserRound className="size-5" /> {t("spec.self.callAttendant")}
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn("size-11", !needsAttendant(l) && "ml-auto")}
                      aria-label={t("till.remove")}
                      onClick={() => setQuantity(l.key, 0)}
                    >
                      <X className="size-5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-3 border-t p-6">
          {quote.error && (
            <Alert variant="destructive">
              <AlertDescription>{getApiErrorMessage(quote.error, t("till.saleError"))}</AlertDescription>
            </Alert>
          )}
          {waiting && <p className="text-center text-lg font-semibold text-amber-700 dark:text-amber-400">{t("spec.self.waiting")}</p>}
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold">{t("till.total")}</span>
            <span className={cn("text-4xl font-bold tabular-nums", basket.length > 0 && !quoteCurrent && "opacity-50")} data-testid="self-total">
              {basket.length === 0 ? money(0) : q && !waiting ? money(q.total) : "…"}
            </span>
          </div>
          <Button className="h-16 text-2xl" disabled={!canPay} onClick={() => pay.mutate()}>
            <CreditCard className="size-6" /> {t(pay.isPending ? "spec.self.paying" : "spec.self.payCard")}
          </Button>
        </div>
      </section>

      {weigh && (
        <ValuePrompt
          kind="weight"
          item={weigh}
          onValue={(value) => {
            const item = weigh;
            setWeigh(null);
            add(item, { quantity: value });
          }}
          onCancel={() => setWeigh(null)}
        />
      )}
      {attendantFor && (
        <AttendantPinDialog
          question={t("spec.self.attendant.question", { item: attendantFor.item.name, age: attendantFor.item.minimumAge ?? 0 })}
          onVerified={() => {
            const key = attendantFor.key;
            setBasket((all) => all.map((l) => (l.key === key ? { ...l, ageVerified: true } : l)));
            setAttendantFor(null);
          }}
          onCancel={() => setAttendantFor(null)}
        />
      )}
      {closing === "pin" && (
        <AttendantPinDialog question={t("spec.self.closeLane.question")} onVerified={() => setClosing("dialog")} onCancel={() => setClosing(null)} />
      )}
      {closing === "dialog" && <CloseSessionDialog boot={boot} sessionId={sessionId} onClose={() => setClosing(null)} />}
      {done && <DoneDialog boot={boot} order={done} onClose={() => setDone(null)} />}
    </div>
  );
}
