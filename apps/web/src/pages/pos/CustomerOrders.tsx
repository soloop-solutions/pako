import { useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { CustomerOrderResponse } from "@pako/shared";
import { Plus, X } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosRegisters, usePosStores } from "@/hooks/usePos";
import { useItemSearch } from "@/hooks/useStock";
import { useUrlParam } from "@/hooks/useUrlParam";
import {
  CUSTOMER_ORDER_KINDS,
  CUSTOMER_ORDER_STATES,
  CustomerOrderKind,
  CustomerOrderState,
  customerOrderKindKey,
  customerOrderStateKey,
} from "@/lib/pos-enums";
import { cn } from "@/lib/utils";

const GRID_ID = "pos-customer-orders";
const ALL = "all";
const money = (v: number) => v.toFixed(2);

// docs/POS_PLAN.md P2: layaways and special orders. Deposits are taken and orders collected at the
// till; here they are created, edited, marked ready and cancelled. Totals, deposits and what is
// left are the server's.
export function CustomerOrders() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [state, setState] = useUrlParam("state", ALL, [`${GRID_ID}.page`]);
  const [editing, setEditing] = useState<CustomerOrderResponse | "new" | null>(null);
  const [cancelling, setCancelling] = useState<CustomerOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ["customerOrders", activeCompanyId, state, grid.globalFilter, grid.page, grid.pageSize],
    queryFn: () =>
      apiClient.listCustomerOrders(activeCompanyId as string, state === ALL ? undefined : Number(state), grid.globalFilter || undefined, grid.page, grid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customerOrders", activeCompanyId] });

  const ready = useMutation({
    mutationFn: (id: string) => apiClient.markCustomerOrderReady(activeCompanyId as string, id),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  const columns = useMemo<ColumnDef<CustomerOrderResponse>[]>(
    () => [
      { accessorKey: "number", header: t("pos.customerOrder.number"), cell: ({ row }) => <span className="tabular-nums">{row.original.number}</span> },
      { id: "kind", header: t("pos.customerOrder.kind"), accessorFn: (o) => t(`pos.customerOrder.kind.${customerOrderKindKey(o.kind)}`) },
      { accessorKey: "customerName", header: t("pos.customerOrder.customer") },
      {
        id: "state",
        header: t("pos.customerOrder.state"),
        accessorFn: (o) => t(`pos.customerOrder.state.${customerOrderStateKey(o.state)}`),
        cell: ({ row, getValue }) => (
          <Badge variant={row.original.state === CustomerOrderState.Ready ? "default" : row.original.state === CustomerOrderState.Open ? "outline" : "secondary"}>
            {getValue() as string}
          </Badge>
        ),
      },
      { id: "dueDate", header: t("pos.customerOrder.dueDate"), accessorFn: (o) => (o.dueDate ? intl.formatDate(o.dueDate) : "—") },
      { accessorKey: "total", header: t("pos.customerOrder.total"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "deposited", header: t("pos.customerOrder.deposited"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "remaining", header: t("pos.customerOrder.remaining"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const o = row.original;
          const closed = o.state === CustomerOrderState.Collected || o.state === CustomerOrderState.Cancelled;
          return (
            <span className="flex justify-end gap-1">
              {canWrite("pos") && o.state === CustomerOrderState.Open && (
                <Button size="xs" variant="outline" disabled={ready.isPending} onClick={() => ready.mutate(o.id)}>
                  {t("pos.customerOrder.markReady")}
                </Button>
              )}
              {canApprove("pos") && !closed && (
                <Button size="xs" variant="ghost" onClick={() => setCancelling(o)}>
                  {t("pos.customerOrder.cancel")}
                </Button>
              )}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, ready.isPending],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("nav.posCustomerOrders")}</CardTitle>
          <CardDescription>{t("nav.posCustomerOrders.description")}</CardDescription>
        </div>
        {canWrite("pos") && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("pos.customerOrder.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex w-48 flex-col gap-1">
          <Label htmlFor="co-state-filter">{t("pos.customerOrder.state")}</Label>
          <Select
            id="co-state-filter"
            value={state}
            onValueChange={setState}
            options={[
              { value: ALL, label: t("pos.customerOrder.state.all") },
              ...CUSTOMER_ORDER_STATES.map((s) => ({ value: String(s), label: t(`pos.customerOrder.state.${customerOrderStateKey(s)}`) })),
            ]}
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={orders.data?.items ?? []}
          rowCount={orders.data?.total ?? 0}
          isLoading={orders.isPending}
          getRowId={(o) => o.id}
          getRowClassName={(o) =>
            o.state === CustomerOrderState.Cancelled ? "text-muted-foreground line-through" : o.state === CustomerOrderState.Collected ? "text-muted-foreground" : undefined
          }
          onRowClick={canWrite("pos") ? setEditing : undefined}
          enableGlobalFilter
          globalFilterPlaceholder={t("pos.customerOrder.search")}
          emptyMessage={t("pos.customerOrder.empty")}
          exportFileName="customer-orders"
        />
      </CardContent>
      {editing && (
        <CustomerOrderDialog
          order={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {cancelling && (
        <CancelOrderDialog
          order={cancelling}
          onClose={() => setCancelling(null)}
          onDone={async () => {
            setCancelling(null);
            await refresh();
          }}
        />
      )}
    </Card>
  );
}

interface LineDraft {
  key: string;
  itemId: string;
  description?: string;
  quantity: string;
  unitPrice: string;
}

function CustomerOrderDialog({ order, onClose, onSaved }: { order: CustomerOrderResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const stores = (usePosStores().data ?? []).filter((s) => s.isActive || s.id === order?.storeId);
  const customers = (useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []).filter((p) => p.isCustomer || p.id === order?.customerId);
  const itemSearch = useItemSearch();
  const closed = !!order && (order.state === CustomerOrderState.Collected || order.state === CustomerOrderState.Cancelled);

  const [storeId, setStoreId] = useState(order?.storeId ?? "");
  const [kind, setKind] = useState(String(order?.kind ?? CustomerOrderKind.Layaway));
  const [customerId, setCustomerId] = useState(order?.customerId ?? "");
  const [dueDate, setDueDate] = useState(order?.dueDate ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    () =>
      order?.lines.map((l) => ({ key: l.id, itemId: l.itemId, description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })) ?? [
        { key: crypto.randomUUID(), itemId: "", quantity: "1", unitPrice: "" },
      ],
  );
  const [error, setError] = useState<string | null>(null);

  const itemOptions = useMemo(() => {
    const options = itemSearch.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.unit }));
    const listed = new Set(options.map((o) => o.value));
    // A saved line's item no search has returned yet keeps its description as a label.
    for (const l of lines) if (l.itemId && !listed.has(l.itemId) && l.description) options.push({ value: l.itemId, label: l.description, description: "" });
    return options;
  }, [itemSearch.items, lines]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        storeId,
        kind: Number(kind),
        customerId,
        dueDate: dueDate || undefined,
        notes: notes.trim() || undefined,
        // An empty price takes the store's price on the day.
        lines: lines
          .filter((l) => l.itemId)
          .map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: l.unitPrice.trim() ? Number(l.unitPrice) : undefined })),
      };
      return order ? apiClient.updateCustomerOrder(activeCompanyId as string, order.id, body) : apiClient.createCustomerOrder(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const patch = (key: string, change: Partial<LineDraft>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l)));
  const valid = !!storeId && !!customerId && lines.some((l) => l.itemId) && lines.every((l) => !l.itemId || Number(l.quantity) > 0);

  return (
    <FormDialog open onOpenChange={(open) => !open && !save.isPending && onClose()} title={order ? order.number : t("pos.customerOrder.new")} size="lg">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {order && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t(`pos.customerOrder.state.${customerOrderStateKey(order.state)}`)} · {t("pos.customerOrder.total")} {money(order.total)} ·{" "}
            {t("pos.customerOrder.deposited")} {money(order.deposited)} · {t("pos.customerOrder.remaining")} {money(order.remaining)} ·{" "}
            {t("pos.customerOrder.depositCard")} {order.depositCardNumber}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="co-store">{t("pos.register.store")}</Label>
            <Select id="co-store" value={storeId} onValueChange={setStoreId} disabled={closed} placeholder={t("pos.register.store")} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="co-kind">{t("pos.customerOrder.kind")}</Label>
            <Select
              id="co-kind"
              value={kind}
              onValueChange={setKind}
              disabled={closed}
              options={CUSTOMER_ORDER_KINDS.map((k) => ({ value: String(k), label: t(`pos.customerOrder.kind.${customerOrderKindKey(k)}`) }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="co-customer">{t("pos.customerOrder.customer")}</Label>
            <SearchableSelect
              id="co-customer"
              value={customerId}
              onChange={setCustomerId}
              placeholder={t("pos.customerOrder.customer.pick")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              options={customers.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
            />
          </div>
        </div>
        <p className="text-sm font-medium">{t("pos.customerOrder.lines")}</p>
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.key} className="grid grid-cols-[1fr_6rem_7rem_auto] items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs" htmlFor={`co-item-${l.key}`}>{t("pos.customerOrder.item")}</Label>
                <SearchableSelect
                  id={`co-item-${l.key}`}
                  value={l.itemId}
                  onChange={(v) => patch(l.key, { itemId: v })}
                  onSearchChange={itemSearch.onSearchChange}
                  placeholder={t("pos.customerOrder.item.pick")}
                  searchPlaceholder={t("common.search")}
                  noResultsText={t("common.noResults")}
                  options={itemOptions}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs" htmlFor={`co-qty-${l.key}`}>{t("pos.customerOrder.quantity")}</Label>
                <Input id={`co-qty-${l.key}`} type="number" min={0.001} step="any" className="text-right tabular-nums" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs" htmlFor={`co-price-${l.key}`}>{t("pos.customerOrder.unitPrice")}</Label>
                <Input
                  id={`co-price-${l.key}`}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={t("pos.customerOrder.unitPrice.store")}
                  className="text-right tabular-nums"
                  value={l.unitPrice}
                  onChange={(e) => patch(l.key, { unitPrice: e.target.value })}
                />
              </div>
              <Button type="button" size="sm" variant="ghost" aria-label={t("till.remove")} onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => setLines((all) => [...all, { key: crypto.randomUUID(), itemId: "", quantity: "1", unitPrice: "" }])}
        >
          <Plus className="size-4" /> {t("pos.customerOrder.addLine")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("pos.customerOrder.unitPrice.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div className="flex flex-col gap-1">
            <Label htmlFor="co-due">{t("pos.customerOrder.dueDate")}</Label>
            <Input id="co-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="co-notes">{t("pos.customerOrder.notes")}</Label>
            <Textarea id="co-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={closed || !valid || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// Cancelling pays any deposits back in cash from an open session's drawer (Approve).
function CancelOrderDialog({ order, onClose, onDone }: { order: CustomerOrderResponse; onClose: () => void; onDone: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const sessions = (usePosRegisters().data ?? []).filter((r) => !!r.openSessionId);
  const [reason, setReason] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => apiClient.cancelCustomerOrder(activeCompanyId as string, order.id, { reason: reason.trim(), sessionId: sessionId || undefined }),
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const needsSession = order.deposited > 0;
  return (
    <FormDialog open onOpenChange={(open) => !open && !cancel.isPending && onClose()} title={t("pos.customerOrder.cancelTitle", { number: order.number })} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          cancel.mutate();
        }}
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Label htmlFor="co-cancel-reason">{t("till.return.reason")}</Label>
        <Input id="co-cancel-reason" required autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        {needsSession && (
          <>
            <p className={cn("text-sm text-muted-foreground")}>{t("pos.customerOrder.cancel.refund", { amount: money(order.deposited) })}</p>
            <Label htmlFor="co-cancel-session">{t("pos.customerOrder.cancel.session")}</Label>
            <Select
              id="co-cancel-session"
              value={sessionId}
              onValueChange={setSessionId}
              placeholder={t("pos.customerOrder.cancel.session.pick")}
              options={sessions.map((r) => ({ value: r.openSessionId as string, label: `${r.code} · ${r.name} (${r.storeName})` }))}
            />
            {sessions.length === 0 && <p className="text-sm text-destructive">{t("pos.customerOrder.cancel.noSession")}</p>}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={cancel.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" variant="destructive" disabled={!reason.trim() || (needsSession && !sessionId) || cancel.isPending}>
            {t("pos.customerOrder.cancel")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
