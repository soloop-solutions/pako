import { useEffect, useState } from "react";
import type { KitchenTicketResponse } from "@pako/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { KitchenTicketState, kitchenTicketStateKey } from "@/lib/pos-enums";
import { usePosHub } from "@/lib/pos-hub";
import { cn } from "@/lib/utils";

const COLUMNS = [KitchenTicketState.New, KitchenTicketState.InProgress, KitchenTicketState.Ready] as const;
// A tap moves a ticket one stage on; Ready → Done takes it off the screen.
const NEXT: Record<number, number> = {
  [KitchenTicketState.New]: KitchenTicketState.InProgress,
  [KitchenTicketState.InProgress]: KitchenTicketState.Ready,
  [KitchenTicketState.Ready]: KitchenTicketState.Done,
};

const COLUMN_CLASS: Record<number, string> = {
  [KitchenTicketState.New]: "border-t-sky-500",
  [KitchenTicketState.InProgress]: "border-t-amber-500",
  [KitchenTicketState.Ready]: "border-t-emerald-500",
};

/** Minutes since a moment — clock time, not money. */
function minutesSince(iso: string, now: number): number {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60_000)) : 0;
}

// docs/POS_PLAN.md P3: the kitchen display. Full screen, outside the app shell like the till. The
// store and production centre are URL params (?store=…&center=…), so each screen is a bookmark.
// Tickets refresh live over SignalR ("tickets"), with polling every 15 s as a fallback.
export function Kds() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const storeId = params.get("store") ?? "";
  const centerId = params.get("center") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const stores = useQuery({ queryKey: ["posStores", companyId], queryFn: () => apiClient.listPosStores(companyId), enabled: !!activeCompanyId });
  const menu = useQuery({ queryKey: ["posMenu", companyId], queryFn: () => apiClient.getPosMenu(companyId), enabled: !!activeCompanyId, staleTime: 5 * 60_000 });
  const centers = (menu.data?.centers ?? []).filter((c) => c.isActive && (!c.storeId || c.storeId === storeId));

  // One store: take it.
  const onlyStore = stores.data?.filter((s) => s.isActive).length === 1 ? stores.data.find((s) => s.isActive) : undefined;
  useEffect(() => {
    if (!storeId && onlyStore) setParams((p) => {
      const q = new URLSearchParams(p);
      q.set("store", onlyStore.id);
      return q;
    }, { replace: true });
  }, [storeId, onlyStore, setParams]);

  const ticketsKey = ["posKitchenTickets", companyId, storeId, centerId];
  const tickets = useQuery({
    queryKey: ticketsKey,
    queryFn: () => apiClient.listKitchenTickets(companyId, storeId, centerId || undefined, false),
    enabled: !!activeCompanyId && !!storeId,
    refetchInterval: 15_000,
  });
  usePosHub(companyId, storeId || undefined, {
    tickets: () => void queryClient.invalidateQueries({ queryKey: ["posKitchenTickets", companyId, storeId] }),
  });

  const advance = useMutation({
    mutationFn: (ticket: KitchenTicketResponse) => apiClient.setKitchenTicketState(companyId, ticket.id, { state: NEXT[ticket.state] }),
    onMutate: (ticket) => {
      setError(null);
      // Moves at once; the refetch confirms it.
      queryClient.setQueryData<KitchenTicketResponse[]>(ticketsKey, (all) =>
        (all ?? []).flatMap((x) => (x.id !== ticket.id ? [x] : NEXT[x.state] === KitchenTicketState.Done ? [] : [{ ...x, state: NEXT[x.state] }])),
      );
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ticketsKey }),
  });

  function setParam(key: string, value: string) {
    setParams((p) => {
      const q = new URLSearchParams(p);
      if (value) q.set(key, value);
      else q.delete(key);
      if (key === "store") q.delete("center");
      return q;
    });
  }

  const list = tickets.data ?? [];
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <Button size="sm" variant="ghost" onClick={() => navigate("/pos")} aria-label={t("till.exit")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-semibold">{t("rest.kds.title")}</h1>
        <div className="w-56">
          <Select
            value={storeId}
            onValueChange={(v) => setParam("store", v)}
            placeholder={t("rest.kds.store")}
            options={(stores.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
        <div className="w-56">
          <Select
            value={centerId}
            onValueChange={(v) => setParam("center", v)}
            options={[{ value: "", label: t("rest.kds.allCenters") }, ...centers.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">{intl.formatTime(now)}</span>
      </header>
      {error && (
        <Alert variant="destructive" className="m-2 w-auto">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!storeId ? (
        <p className="p-6 text-muted-foreground">{t("rest.kds.pickStore")}</p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-3 p-3">
          {COLUMNS.map((state) => {
            const column = list.filter((x) => x.state === state);
            return (
              <section key={state} className={cn("flex min-h-0 flex-col rounded-md border border-t-4 bg-muted/30", COLUMN_CLASS[state])} data-testid={`kds-${kitchenTicketStateKey(state)}`}>
                <h2 className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                  {t(`rest.kds.${kitchenTicketStateKey(state)}`)}
                  <Badge variant="secondary">{column.length}</Badge>
                </h2>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {column.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} now={now} onAdvance={() => advance.mutate(ticket)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TicketCard({ ticket, now, onAdvance }: { ticket: KitchenTicketResponse; now: number; onAdvance: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const age = minutesSince(ticket.createdAt, now);
  const next = NEXT[ticket.state];
  const courses = [...new Set(ticket.lines.map((l) => l.course))].sort((a, b) => a - b);
  return (
    <button
      type="button"
      onClick={onAdvance}
      aria-label={t("rest.kds.advance", { number: ticket.number, state: t(`rest.kds.${kitchenTicketStateKey(next)}`) })}
      className={cn(
        "flex flex-col gap-1 rounded-md border-2 bg-background p-2 text-left shadow-xs hover:bg-accent",
        ticket.isStorno && "border-red-600 bg-red-50 dark:bg-red-950",
        !ticket.isStorno && age >= 20 && "border-amber-500",
      )}
      data-testid="kds-ticket"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold tabular-nums">#{ticket.number}</span>
        {ticket.isStorno && <Badge variant="destructive">{t("rest.kds.storno")}</Badge>}
        <span className={cn("text-sm tabular-nums", age >= 20 ? "font-bold text-destructive" : "text-muted-foreground")}>
          {t("rest.kds.minutes", { minutes: age })}
        </span>
      </span>
      <span className="flex justify-between gap-2 text-sm">
        <span className="font-medium">{ticket.tabLabel}</span>
        <span className="text-muted-foreground">{ticket.waiterName}</span>
      </span>
      {ticket.productionCenterName && <span className="text-xs text-muted-foreground">{ticket.productionCenterName}</span>}
      {courses.map((c) => (
        <div key={c} className="flex flex-col">
          {courses.length > 1 && <span className="text-[11px] font-semibold uppercase text-muted-foreground">{t("rest.courseN", { course: c })}</span>}
          {ticket.lines.filter((l) => l.course === c).map((l) => (
            <div key={l.tabLineId} className={cn("flex flex-col border-t py-0.5", ticket.isStorno && "line-through")}>
              <span className="text-base font-semibold">
                <span className="tabular-nums">{intl.formatNumber(l.quantity)}×</span> {l.description}
                {l.seat != null && <span className="ml-1 text-xs font-normal text-muted-foreground">{t("rest.seatN", { seat: l.seat })}</span>}
              </span>
              {l.modifiers && <span className="text-sm">{l.modifiers}</span>}
              {l.note && <span className="text-sm italic text-amber-700 dark:text-amber-400">“{l.note}”</span>}
            </div>
          ))}
        </div>
      ))}
    </button>
  );
}
