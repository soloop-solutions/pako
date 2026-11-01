import { useState, type FormEvent } from "react";
import type { FloorPlanResponse, FloorPlanTableResponse, TabResponse, TabSummaryResponse } from "@pako/shared";
import { useMutation } from "@tanstack/react-query";
import { Bike, Plus, ShoppingBag, Users } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { TabKind, TabState, TableShape, tabKindKey } from "@/lib/pos-enums";
import { cn } from "@/lib/utils";
import { tabKindLabelKey } from "@/pages/pos/restaurant/tab-utils";

const money = (v: number | undefined) => (v ?? 0).toFixed(2);

// One grid cell of the floor designer, in pixels.
const CELL = 56;

type TableStatus = "free" | "open" | "preBilled" | "requests";

function tableStatus(tabs: TabSummaryResponse[]): TableStatus {
  if (tabs.length === 0) return "free";
  if (tabs.some((x) => x.requestedLines > 0)) return "requests";
  if (tabs.every((x) => x.state === TabState.PreBilled)) return "preBilled";
  return "open";
}

// State shows in form: free tables are plain and dashed, open ones solid blue, a printed bill
// amber, a guest's QR order waiting red with a ring.
const STATUS_CLASS: Record<TableStatus, string> = {
  free: "border-dashed border-border bg-background text-muted-foreground",
  open: "border-sky-600 bg-sky-50 text-sky-950 dark:bg-sky-950 dark:text-sky-50",
  preBilled: "border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50",
  requests: "border-red-600 bg-red-50 text-red-950 ring-2 ring-red-500 ring-offset-1 dark:bg-red-950 dark:text-red-50",
};

export function FloorPlanView({ storeId, plan, floorId, onFloor, onOpenTab, toolbar }: {
  storeId: string;
  plan: FloorPlanResponse | undefined;
  floorId: string | null;
  onFloor: (floorId: string) => void;
  onOpenTab: (tabId: string) => void;
  toolbar: React.ReactNode;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [opening, setOpening] = useState<{ kind: number; table?: FloorPlanTableResponse } | null>(null);
  const [picking, setPicking] = useState<FloorPlanTableResponse | null>(null);

  const floors = plan?.floors ?? [];
  const floor = floors.find((f) => f.id === floorId) ?? floors[0];
  const width = Math.max(8, ...(floor?.tables ?? []).map((x) => x.x + x.width)) * CELL;
  const height = Math.max(6, ...(floor?.tables ?? []).map((x) => x.y + x.height)) * CELL;

  function tapTable(table: FloorPlanTableResponse) {
    if (table.tabs.length === 0) setOpening({ kind: TabKind.DineIn, table });
    else if (table.tabs.length === 1) onOpenTab(table.tabs[0].id);
    else setPicking(table);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_20rem]">
      <section className="flex min-h-0 flex-col gap-3 border-r p-4">
        <div className="flex flex-wrap items-center gap-2">
          {floors.map((f) => (
            <Button key={f.id} size="sm" variant={f.id === floor?.id ? "default" : "outline"} onClick={() => onFloor(f.id)}>
              {f.name}
            </Button>
          ))}
          <Legend />
        </div>
        {!plan ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : floors.length === 0 ? (
          <Alert>
            <AlertDescription>{t("rest.floor.none")}</AlertDescription>
          </Alert>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30">
            <div
              className="relative"
              style={{
                width, height,
                backgroundImage: "radial-gradient(circle, var(--color-border) 1px, transparent 1px)",
                backgroundSize: `${CELL}px ${CELL}px`,
              }}
              data-testid="floor-plan"
            >
              {floor?.tables.map((table) => {
                const status = tableStatus(table.tabs);
                const tab = table.tabs[0];
                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => tapTable(table)}
                    className={cn(
                      "absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden border-2 p-1 text-center text-xs shadow-xs hover:brightness-95 focus-visible:outline-2",
                      table.shape === TableShape.Round ? "rounded-full" : "rounded-md",
                      STATUS_CLASS[status],
                    )}
                    style={{ left: table.x * CELL + 4, top: table.y * CELL + 4, width: table.width * CELL - 8, height: table.height * CELL - 8 }}
                    aria-label={t("rest.table.label", { name: table.name, status: t(`rest.table.status.${status}`) })}
                    data-testid="floor-table"
                    data-status={status}
                  >
                    <span className="text-sm font-bold">{table.name}</span>
                    {tab ? (
                      <>
                        <span className="flex items-center gap-1 tabular-nums">
                          <Users className="size-3" /> {tab.covers}
                          {table.tabs.length > 1 && <span>· {t("rest.table.tabs", { count: table.tabs.length })}</span>}
                        </span>
                        <span className="max-w-full truncate">{tab.waiterName}</span>
                        <span className="font-semibold tabular-nums">{money(tab.due)}</span>
                        {tab.requestedLines > 0 && <Badge variant="destructive">{t("rest.table.qr", { count: tab.requestedLines })}</Badge>}
                      </>
                    ) : (
                      <span className="flex items-center gap-1 tabular-nums">
                        <Users className="size-3" /> {table.seats}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">{toolbar}</div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setOpening({ kind: TabKind.Takeaway })}>
            <ShoppingBag className="size-4" /> {t("rest.newTakeaway")}
          </Button>
          <Button variant="outline" onClick={() => setOpening({ kind: TabKind.Delivery })}>
            <Bike className="size-4" /> {t("rest.newDelivery")}
          </Button>
        </div>
        <h2 className="text-sm font-semibold">{t("rest.otherTabs")}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {(plan?.otherTabs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("rest.otherTabs.none")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {plan?.otherTabs.map((x) => (
                <li key={x.id}>
                  <TabSummaryButton tab={x} onClick={() => onOpenTab(x.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {opening && (
        <OpenTabDialog
          storeId={storeId}
          kind={opening.kind}
          table={opening.table}
          onClose={() => setOpening(null)}
          onOpened={(tab) => {
            setOpening(null);
            onOpenTab(tab.id);
          }}
        />
      )}
      {picking && (
        <FormDialog open onOpenChange={(open) => !open && setPicking(null)} title={t("rest.table.pick", { name: picking.name })} size="sm">
          <div className="flex flex-col gap-2">
            <ul className="divide-y rounded-md border">
              {picking.tabs.map((x) => (
                <li key={x.id}>
                  <TabSummaryButton tab={x} onClick={() => onOpenTab(x.id)} />
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              onClick={() => {
                setOpening({ kind: TabKind.DineIn, table: picking });
                setPicking(null);
              }}
            >
              <Plus className="size-4" /> {t("rest.table.newTab")}
            </Button>
          </div>
        </FormDialog>
      )}
    </div>
  );
}

function Legend() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {(["free", "open", "preBilled", "requests"] as const).map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cn("inline-block size-3 rounded-sm border-2", STATUS_CLASS[s])} />
          {t(`rest.table.status.${s}`)}
        </span>
      ))}
    </div>
  );
}

export function TabSummaryButton({ tab, onClick }: { tab: TabSummaryResponse; onClick: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  return (
    <button type="button" className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent" onClick={onClick} data-testid="tab-summary">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {tab.number}
          {tab.name ? ` · ${tab.name}` : ""}
          {tab.tableName ? ` · ${tab.tableName}` : ""}
        </span>
        <span className="font-semibold tabular-nums">{money(tab.due)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Badge variant="outline">{t(tabKindLabelKey(tab.kind))}</Badge>
        {tab.state === TabState.PreBilled && <Badge variant="warning">{t("rest.state.preBilled")}</Badge>}
        {tab.requestedLines > 0 && <Badge variant="destructive">{t("rest.table.qr", { count: tab.requestedLines })}</Badge>}
        {tab.waiterName} · {intl.formatTime(tab.openedAt)}
      </span>
    </button>
  );
}

// Covers for a table; name, phone and address for takeaway and delivery.
function OpenTabDialog({ storeId, kind, table, onClose, onOpened }: {
  storeId: string;
  kind: number;
  table?: FloorPlanTableResponse;
  onClose: () => void;
  onOpened: (tab: TabResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [covers, setCovers] = useState(table ? String(Math.min(2, table.seats || 2)) : "0");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () =>
      apiClient.openPosTab(activeCompanyId as string, {
        storeId, kind, covers: Number(covers) || 0,
        ...(table ? { tableId: table.id } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { deliveryPhone: phone.trim() } : {}),
        ...(address.trim() ? { deliveryAddress: address.trim() } : {}),
      }),
    onSuccess: onOpened,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const dineIn = kind === TabKind.DineIn;
  const title = table ? t("rest.open.table", { name: table.name }) : t(`rest.open.${tabKindKey(kind)}`);
  const coversValid = /^\d{1,3}$/.test(covers.trim());
  return (
    <FormDialog open onOpenChange={(o) => !o && !open.isPending && onClose()} title={title} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (coversValid) open.mutate();
        }}
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {dineIn && (
          <>
            <Label htmlFor="tab-covers">{t("rest.covers")}</Label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Button key={n} type="button" size="sm" variant={covers === String(n) ? "default" : "outline"} onClick={() => setCovers(String(n))}>
                  {n}
                </Button>
              ))}
              <Input id="tab-covers" inputMode="numeric" autoFocus value={covers} onChange={(e) => setCovers(e.target.value)} className="h-8 w-20 text-right tabular-nums" />
            </div>
          </>
        )}
        <Label htmlFor="tab-name">{t("rest.tabName")}</Label>
        <Input id="tab-name" maxLength={80} autoFocus={!dineIn} value={name} onChange={(e) => setName(e.target.value)} />
        {!dineIn && (
          <>
            <Label htmlFor="tab-phone">{t("rest.phone")}</Label>
            <Input id="tab-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </>
        )}
        {kind === TabKind.Delivery && (
          <>
            <Label htmlFor="tab-address">{t("rest.address")}</Label>
            <Input id="tab-address" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={open.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!coversValid || open.isPending}>{t("rest.open")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
