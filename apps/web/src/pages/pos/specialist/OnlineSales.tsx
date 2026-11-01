import { useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ChannelOrderResponse, CodCourierRow, SalesChannelResponse } from "@pako/shared";
import { Copy, Plus, RefreshCw, ShoppingBag, Truck } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { API_BASE_URL, apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosRegisters, usePosStores } from "@/hooks/usePos";
import { useUrlParam } from "@/hooks/useUrlParam";
import {
  CHANNEL_ORDER_STATES, ChannelFulfilment, ChannelOrderState, ChannelPayment, SALES_CHANNEL_KINDS, channelFulfilmentKey, channelOrderStateKey,
  channelPaymentKey, salesChannelKindKey,
} from "@/lib/pos-enums";
import { pickTillRegister, todayLocal } from "@/lib/pos-services";
import { ConfirmDialog, ErrorAlert } from "@/pages/pos/hotel/hotel-shared";
import { Field, TabBar } from "@/pages/pos/specialist/shared";
import { money, qty, usePartners } from "@/pages/pos/specialist/specialist-utils";

type Tab = "orders" | "cod" | "channels";
const TABS: Tab[] = ["orders", "cod", "channels"];
const ALL = "all";
const ORDERS_GRID = "pos-channel-orders";

const isOpen = (o: ChannelOrderResponse) =>
  !o.posOrderId && (o.state === ChannelOrderState.New || o.state === ChannelOrderState.Accepted || o.state === ChannelOrderState.Ready);
const needsCourier = (o: ChannelOrderResponse) => o.fulfilment === ChannelFulfilment.Delivery && o.payment === ChannelPayment.CashOnDelivery;

// docs/POS_PLAN.md §6.8 / P7 online channels: orders from webshops and marketplaces, fiscalised at
// the store's till; cash on delivery the couriers hold; the channels and their integration tokens.
export function OnlineSales() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [tabParam, setTab] = useUrlParam("tab", "orders");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "orders";
  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <TabBar label={t("spec.nav.online")} value={tab} onChange={setTab} tabs={TABS.map((id) => ({ id, label: t(`spec.online.tab.${id}`) }))} />
      {tab === "orders" && <OrdersTab />}
      {tab === "cod" && <CodTab />}
      {tab === "channels" && <ChannelsTab />}
    </div>
  );
}

function StateBadge({ state }: { state: number }) {
  const intl = useIntl();
  const variant = state === ChannelOrderState.New ? "default" : state === ChannelOrderState.Cancelled || state === ChannelOrderState.Returned ? "secondary" : "outline";
  return <Badge variant={variant}>{intl.formatMessage({ id: `spec.online.state.${channelOrderStateKey(state)}` })}</Badge>;
}

// ---- Orders ----

function OrdersTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const stores = usePosStores().data ?? [];
  const grid = useDataGridUrlState(ORDERS_GRID, 50);
  const [store, setStore] = useUrlParam("store", ALL, [`${ORDERS_GRID}.page`]);
  const [state, setState] = useUrlParam("state", ALL, [`${ORDERS_GRID}.page`]);
  const [opened, setOpened] = useState<ChannelOrderResponse | null>(null);
  const orders = useQuery({
    queryKey: ["posChannelOrders", activeCompanyId, store, state, grid.globalFilter, grid.page, grid.pageSize],
    queryFn: () =>
      apiClient.listPosChannelOrders(
        activeCompanyId as string, store === ALL ? undefined : store, state === ALL ? undefined : Number(state), grid.globalFilter || undefined, grid.page, grid.pageSize,
      ),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const columns = useMemo<ColumnDef<ChannelOrderResponse>[]>(
    () => [
      { accessorKey: "number", header: t("spec.online.number"), cell: ({ getValue }) => <span className="tabular-nums">{getValue() as string}</span> },
      { accessorKey: "externalRef", header: t("spec.online.externalRef") },
      { id: "createdAt", header: t("common.date"), accessorFn: (o) => intl.formatDate(o.createdAt, { dateStyle: "short", timeStyle: "short" }) },
      { accessorKey: "channelName", header: t("spec.online.channel") },
      { accessorKey: "customerName", header: t("common.customer") },
      { id: "fulfilment", header: t("spec.online.fulfilment"), accessorFn: (o) => t(`spec.online.fulfilment.${channelFulfilmentKey(o.fulfilment)}`) },
      { id: "payment", header: t("spec.online.payment"), accessorFn: (o) => t(`spec.online.payment.${channelPaymentKey(o.payment)}`) },
      { accessorKey: "total", header: t("common.total"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { id: "state", header: t("spec.status"), accessorFn: (o) => t(`spec.online.state.${channelOrderStateKey(o.state)}`), cell: ({ row }) => <StateBadge state={row.original.state} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("spec.online.tab.orders")}</CardTitle>
        <CardDescription>{t("spec.online.orders.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Field id="co-store" label={t("spec.store")} className="w-56">
            <Select
              id="co-store"
              value={store}
              onValueChange={setStore}
              options={[{ value: ALL, label: t("spec.allStores") }, ...stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))]}
            />
          </Field>
          <Field id="co-state" label={t("spec.status")} className="w-56">
            <Select
              id="co-state"
              value={state}
              onValueChange={setState}
              options={[{ value: ALL, label: t("spec.online.state.all") }, ...CHANNEL_ORDER_STATES.map((s) => ({ value: String(s), label: t(`spec.online.state.${channelOrderStateKey(s)}`) }))]}
            />
          </Field>
        </div>
        <ErrorAlert message={orders.error ? getApiErrorMessage(orders.error, t("spec.loadError")) : null} />
        <DataGrid
          gridId={ORDERS_GRID}
          columns={columns}
          data={orders.data?.items ?? []}
          rowCount={orders.data?.total ?? 0}
          isLoading={orders.isPending}
          getRowId={(o) => o.id}
          getRowClassName={(o) => (o.state === ChannelOrderState.Cancelled ? "text-muted-foreground line-through" : o.state >= ChannelOrderState.Completed ? "text-muted-foreground" : undefined)}
          onRowClick={setOpened}
          enableGlobalFilter
          globalFilterPlaceholder={t("spec.online.search")}
          emptyMessage={t("spec.online.empty")}
          exportFileName="online-orders"
        />
      </CardContent>
      {opened && (
        <ChannelOrderDialog
          order={opened}
          onClose={() => setOpened(null)}
          onChanged={(o) => {
            setOpened(o);
            void queryClient.invalidateQueries({ queryKey: ["posChannelOrders", activeCompanyId] });
          }}
        />
      )}
    </Card>
  );
}

function ChannelOrderDialog({ order: o, onClose, onChanged }: { order: ChannelOrderResponse; onClose: () => void; onChanged: (o: ChannelOrderResponse) => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const registers = usePosRegisters().data ?? [];
  const customers = (usePartners().data ?? []).filter((p) => p.isCustomer);
  const [courierId, setCourierId] = useState(o.courierPartnerId ?? "");
  const [tracking, setTracking] = useState(o.trackingNumber ?? "");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const delivery = o.fulfilment === ChannelFulfilment.Delivery;
  const setState = useMutation({
    mutationFn: (state: number) =>
      apiClient.setPosChannelOrderState(activeCompanyId as string, o.id, {
        state,
        ...(delivery && courierId && courierId !== o.courierPartnerId ? { courierPartnerId: courierId } : {}),
        ...(delivery && tracking.trim() && tracking.trim() !== o.trackingNumber ? { trackingNumber: tracking.trim() } : {}),
      }),
    onSuccess: (saved) => {
      setConfirmCancel(false);
      setError(null);
      onChanged(saved);
    },
    onError: (err: unknown) => {
      setConfirmCancel(false);
      setError(getApiErrorMessage(err, t("pos.saveError")));
    },
  });
  const till = pickTillRegister(registers, o.storeId);
  const write = canWrite("pos");
  // Cash on delivery is charged to the courier at the till: it is named before the order is ready.
  const courierMissing = needsCourier(o) && !courierId;
  return (
    <FormDialog open onOpenChange={(open) => !open && !setState.isPending && onClose()} title={t("spec.online.title", { number: o.number, channel: o.channelName })} size="lg">
      <div className="flex flex-col gap-3">
        <ErrorAlert message={error} />
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={o.state} />
          <Badge variant="outline">{t(`spec.online.fulfilment.${channelFulfilmentKey(o.fulfilment)}`)}</Badge>
          <Badge variant="outline">{t(`spec.online.payment.${channelPaymentKey(o.payment)}`)}</Badge>
          <span className="text-sm text-muted-foreground">{t("spec.online.externalRef")}: {o.externalRef}</span>
          {o.posOrderNumber && <span className="text-sm">{t("spec.online.coupon", { number: o.posOrderNumber })}</span>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("common.customer")}</dt>
          <dd>{o.customerName}{o.phone ? ` · ${o.phone}` : ""}{o.email ? ` · ${o.email}` : ""}</dd>
          {(o.address || o.city) && (
            <>
              <dt className="text-muted-foreground">{t("spec.online.address")}</dt>
              <dd>{[o.address, o.city].filter(Boolean).join(", ")}</dd>
            </>
          )}
          {o.notes && (
            <>
              <dt className="text-muted-foreground">{t("spec.online.notes")}</dt>
              <dd>{o.notes}</dd>
            </>
          )}
          {o.remittedOn && (
            <>
              <dt className="text-muted-foreground">{t("spec.cod.remitted")}</dt>
              <dd>{intl.formatDate(o.remittedOn)} · {o.remittanceRef}</dd>
            </>
          )}
        </dl>
        <div className="flex flex-col divide-y rounded-md border text-sm" data-testid="channel-order-lines">
          {o.lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_5rem_6rem_6rem] gap-2 px-2 py-1 tabular-nums">
              <span>{l.description}</span>
              <span className="text-right">{qty(l.quantity)}</span>
              <span className="text-right">{money(l.unitPrice)}</span>
              <span className="text-right font-medium">{money(l.total)}</span>
            </div>
          ))}
          {o.shippingFee > 0 && (
            <div className="grid grid-cols-[1fr_6rem] gap-2 px-2 py-1 text-muted-foreground tabular-nums">
              <span>{t("spec.online.shipping")}</span>
              <span className="text-right">{money(o.shippingFee)}</span>
            </div>
          )}
          <div className="grid grid-cols-[1fr_6rem] gap-2 px-2 py-1 font-semibold tabular-nums">
            <span>{t("common.total")}</span>
            <span className="text-right">{money(o.total)}</span>
          </div>
        </div>
        {o.shippingFee > 0 && <p className="text-xs text-muted-foreground">{t("spec.online.shipping.note")}</p>}
        {delivery && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="co-courier" label={t("spec.online.courier")} hint={needsCourier(o) ? t("spec.online.courier.hint") : undefined}>
              <SearchableSelect
                id="co-courier"
                value={courierId}
                onChange={setCourierId}
                disabled={!write || !isOpen(o)}
                placeholder={o.courierName ?? t("spec.online.courier.pick")}
                searchPlaceholder={t("common.search")}
                noResultsText={t("common.noResults")}
                options={customers.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field id="co-tracking" label={t("spec.online.tracking")}>
              <Input id="co-tracking" maxLength={60} disabled={!write || !isOpen(o)} value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </Field>
          </div>
        )}
        {write && (
          <div className="flex flex-wrap justify-end gap-2">
            {isOpen(o) && (
              <Button variant="destructive" disabled={setState.isPending} onClick={() => setConfirmCancel(true)}>{t("spec.online.cancel")}</Button>
            )}
            {o.state === ChannelOrderState.New && (
              <Button variant="outline" disabled={setState.isPending} onClick={() => setState.mutate(ChannelOrderState.Accepted)}>{t("spec.online.accept")}</Button>
            )}
            {(o.state === ChannelOrderState.New || o.state === ChannelOrderState.Accepted) && (
              <Button variant="outline" disabled={setState.isPending || courierMissing} onClick={() => setState.mutate(ChannelOrderState.Ready)}>
                {t("spec.online.ready")}
              </Button>
            )}
            {o.state === ChannelOrderState.Dispatched && (
              <>
                <Button variant="outline" disabled={setState.isPending} onClick={() => setState.mutate(ChannelOrderState.Returned)}>{t("spec.online.returned")}</Button>
                <Button disabled={setState.isPending} onClick={() => setState.mutate(ChannelOrderState.Completed)}>{t("spec.online.delivered")}</Button>
              </>
            )}
            {isOpen(o) && (
              <Button
                disabled={!till || (needsCourier(o) && !o.courierPartnerId)}
                title={!till ? t("spec.online.noTill") : needsCourier(o) && !o.courierPartnerId ? t("spec.online.courier.hint") : undefined}
                onClick={() => till && navigate(`/pos/till/${till.id}?channelOrder=${o.id}`)}
              >
                {delivery ? <Truck className="size-4" /> : <ShoppingBag className="size-4" />}
                {t(delivery ? "spec.online.dispatchAtTill" : "spec.online.checkoutAtTill")}
              </Button>
            )}
          </div>
        )}
        {isOpen(o) && !till && <p className="text-xs text-muted-foreground">{t("spec.online.noTill")}</p>}
      </div>
      {confirmCancel && (
        <ConfirmDialog
          title={t("spec.online.cancel")}
          body={t("spec.online.cancel.confirm", { number: o.number })}
          confirm={t("spec.online.cancel")}
          busy={setState.isPending}
          onConfirm={() => setState.mutate(ChannelOrderState.Cancelled)}
          onClose={() => setConfirmCancel(false)}
        />
      )}
    </FormDialog>
  );
}

// ---- Cash on delivery ----

function CodTab() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ChannelOrderResponse[]>([]);
  const [remitting, setRemitting] = useState(false);
  const report = useQuery({
    queryKey: ["posCod", activeCompanyId],
    queryFn: () => apiClient.getPosCodReport(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const courierColumns = useMemo<ColumnDef<CodCourierRow>[]>(
    () => [
      { accessorKey: "courierName", header: t("spec.online.courier") },
      { accessorKey: "orders", header: t("spec.cod.orders"), meta: { numeric: true } },
      { accessorKey: "amount", header: t("spec.cod.amount"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { id: "oldest", header: t("spec.cod.oldest"), accessorFn: (r) => (r.oldestDispatch ? intl.formatDate(r.oldestDispatch) : "—") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const orderColumns = useMemo<ColumnDef<ChannelOrderResponse>[]>(
    () => [
      { accessorKey: "number", header: t("spec.online.number") },
      { id: "coupon", header: t("spec.cod.coupon"), accessorFn: (o) => o.posOrderNumber ?? "" },
      { id: "courier", header: t("spec.online.courier"), accessorFn: (o) => o.courierName ?? "—" },
      { accessorKey: "customerName", header: t("common.customer") },
      { id: "createdAt", header: t("common.date"), accessorFn: (o) => intl.formatDate(o.createdAt) },
      { id: "state", header: t("spec.status"), accessorFn: (o) => t(`spec.online.state.${channelOrderStateKey(o.state)}`), cell: ({ row }) => <StateBadge state={row.original.state} /> },
      { accessorKey: "total", header: t("common.total"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const couriers = report.data?.couriers ?? [];
  const orders = report.data?.orders ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("spec.online.tab.cod")}</CardTitle>
          <CardDescription>{t("spec.cod.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ErrorAlert message={report.error ? getApiErrorMessage(report.error, t("spec.loadError")) : null} />
          <DataGrid
            gridId="pos-cod-couriers"
            columns={courierColumns}
            data={couriers}
            rowCount={couriers.length}
            isLoading={report.isPending}
            getRowId={(r) => r.courierPartnerId}
            emptyMessage={t("spec.cod.empty")}
            exportFileName="cod-couriers"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("spec.cod.orders.title")}</CardTitle>
            <CardDescription>{t("spec.cod.orders.description")}</CardDescription>
          </div>
          {canApprove("pos") && (
            <Button size="sm" disabled={selected.length === 0} onClick={() => setRemitting(true)}>
              {t("spec.cod.remit", { count: selected.length })}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-cod-orders"
            columns={orderColumns}
            data={orders}
            rowCount={orders.length}
            isLoading={report.isPending}
            getRowId={(o) => o.id}
            enableRowSelection={canApprove("pos")}
            onSelectedRowsChange={setSelected}
            emptyMessage={t("spec.cod.empty")}
            exportFileName="cod-orders"
          />
        </CardContent>
      </Card>
      {remitting && (
        <RemitDialog
          orders={selected}
          onClose={() => setRemitting(false)}
          onDone={async () => {
            setRemitting(false);
            setSelected([]);
            await queryClient.invalidateQueries({ queryKey: ["posCod", activeCompanyId] });
          }}
        />
      )}
    </div>
  );
}

function RemitDialog({ orders, onClose, onDone }: { orders: ChannelOrderResponse[]; onClose: () => void; onDone: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [date, setDate] = useState(todayLocal());
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remit = useMutation({
    mutationFn: () => apiClient.remitPosCod(activeCompanyId as string, { orderIds: orders.map((o) => o.id), remittedOn: date, reference: reference.trim() }),
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    remit.mutate();
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && !remit.isPending && onClose()} title={t("spec.cod.remit.title")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert message={error} />
        <p className="text-sm">{t("spec.cod.remit.orders", { orders: orders.map((o) => o.number).join(", ") })}</p>
        <Field id="remit-date" label={t("spec.cod.remit.date")}>
          <Input id="remit-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="remit-ref" label={t("spec.cod.remit.reference")} hint={t("spec.cod.remit.hint")}>
          <Input id="remit-ref" required maxLength={60} autoFocus value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={remit.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={remit.isPending || !reference.trim() || !date}>{t("spec.cod.remit.confirm")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- Channels ----

function ChannelsTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const stores = usePosStores().data ?? [];
  const [opened, setOpened] = useState<SalesChannelResponse | "new" | null>(null);
  const channels = useQuery({
    queryKey: ["posSalesChannels", activeCompanyId],
    queryFn: () => apiClient.listPosSalesChannels(activeCompanyId as string),
    enabled: !!activeCompanyId && canApprove("pos"),
  });
  const columns = useMemo<ColumnDef<SalesChannelResponse>[]>(
    () => [
      { accessorKey: "name", header: t("common.name") },
      { id: "store", header: t("spec.store"), accessorFn: (c) => stores.find((s) => s.id === c.storeId)?.name ?? "" },
      { id: "kind", header: t("common.type"), accessorFn: (c) => t(`spec.channel.kind.${salesChannelKindKey(c.kind)}`) },
      { accessorKey: "openOrders", header: t("spec.channel.openOrders"), meta: { numeric: true } },
      {
        id: "active",
        header: t("spec.status"),
        accessorFn: (c) => t(c.isActive ? "common.active" : "common.inactive"),
        cell: ({ row, getValue }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{getValue() as string}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, stores],
  );
  const rows = channels.data ?? [];
  const current = opened && opened !== "new" ? rows.find((c) => c.id === opened.id) ?? opened : opened;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("spec.online.tab.channels")}</CardTitle>
          <CardDescription>{t("spec.channel.description")}</CardDescription>
        </div>
        {canApprove("pos") && (
          <Button size="sm" onClick={() => setOpened("new")}>
            <Plus className="size-4" /> {t("spec.channel.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!canApprove("pos") ? (
          <p className="text-sm text-muted-foreground">{t("spec.approveOnly")}</p>
        ) : (
          <DataGrid
            gridId="pos-sales-channels"
            columns={columns}
            data={rows}
            rowCount={rows.length}
            isLoading={channels.isPending}
            getRowId={(c) => c.id}
            getRowClassName={(c) => (c.isActive ? undefined : "text-muted-foreground")}
            onRowClick={setOpened}
            emptyMessage={t("spec.channel.empty")}
          />
        )}
      </CardContent>
      {current && <ChannelDialog channel={current === "new" ? null : current} onClose={() => setOpened(null)} onSaved={setOpened} />}
    </Card>
  );
}

function ChannelDialog({ channel, onClose, onSaved }: { channel: SalesChannelResponse | null; onClose: () => void; onSaved: (c: SalesChannelResponse) => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const stores = usePosStores().data ?? [];
  const [storeId, setStoreId] = useState(channel?.storeId ?? stores.find((s) => s.isActive)?.id ?? "");
  const [name, setName] = useState(channel?.name ?? "");
  const [kind, setKind] = useState(String(channel?.kind ?? 0));
  const [isActive, setIsActive] = useState(channel?.isActive ?? true);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["posSalesChannels", activeCompanyId] });
  const save = useMutation({
    mutationFn: () => {
      const body = { storeId, name: name.trim(), kind: Number(kind), isActive };
      return channel ? apiClient.updatePosSalesChannel(activeCompanyId as string, channel.id, body) : apiClient.createPosSalesChannel(activeCompanyId as string, body);
    },
    onSuccess: async (saved) => {
      await refresh();
      onSaved(saved);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const rotate = useMutation({
    mutationFn: () => apiClient.rotatePosSalesChannelToken(activeCompanyId as string, (channel as SalesChannelResponse).id),
    onSuccess: async (saved) => {
      setConfirmRotate(false);
      await refresh();
      onSaved(saved);
    },
    onError: (err: unknown) => {
      setConfirmRotate(false);
      setError(getApiErrorMessage(err, t("pos.saveError")));
    },
  });
  const base = `${API_BASE_URL.replace(/\/$/, "")}/api/public/channel/${channel?.token ?? "{token}"}`;
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={channel ? channel.name : t("spec.channel.new")} size="md">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <ErrorAlert message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ch-name" label={t("common.name")}>
            <Input id="ch-name" required maxLength={120} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="ch-kind" label={t("common.type")}>
            <Select id="ch-kind" value={kind} onValueChange={setKind} options={SALES_CHANNEL_KINDS.map((k) => ({ value: String(k), label: t(`spec.channel.kind.${salesChannelKindKey(k)}`) }))} />
          </Field>
          <Field id="ch-store" label={t("spec.store")} hint={t("spec.channel.store.hint")}>
            <Select id="ch-store" value={storeId} onValueChange={setStoreId} options={stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("common.active")}
          </label>
        </div>
        {channel && (
          <div className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid="channel-integration">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{t("spec.channel.token")}</span>
              <span className="flex gap-1">
                <Button type="button" size="xs" variant="ghost" aria-label={t("spec.channel.copy")} onClick={() => void navigator.clipboard?.writeText(channel.token)}>
                  <Copy className="size-3" />
                </Button>
                <Button type="button" size="xs" variant="outline" onClick={() => setConfirmRotate(true)}>
                  <RefreshCw className="size-3" /> {t("spec.channel.rotate")}
                </Button>
              </span>
            </div>
            <code className="break-all rounded bg-muted px-2 py-1 text-xs">{channel.token}</code>
            <p className="text-xs text-muted-foreground">{t("spec.channel.integration")}</p>
            <ul className="flex flex-col gap-1 font-mono text-xs">
              <li><span className="font-semibold">GET</span> {base}/catalog</li>
              <li><span className="font-semibold">POST</span> {base}/orders</li>
              <li><span className="font-semibold">GET</span> {base}/orders/{"{externalRef}"}</li>
            </ul>
            <p className="text-xs text-muted-foreground">{t("spec.channel.integration.orders")}</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.close")}</Button>
          <Button type="submit" disabled={save.isPending || !name.trim() || !storeId}>{t("common.save")}</Button>
        </div>
      </form>
      {confirmRotate && (
        <ConfirmDialog
          title={t("spec.channel.rotate")}
          body={t("spec.channel.rotate.confirm")}
          confirm={t("spec.channel.rotate")}
          busy={rotate.isPending}
          onConfirm={() => rotate.mutate()}
          onClose={() => setConfirmRotate(false)}
        />
      )}
    </FormDialog>
  );
}
