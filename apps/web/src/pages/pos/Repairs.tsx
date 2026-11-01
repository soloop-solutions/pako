import { forwardRef, useMemo, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { RepairTicketResponse, StoreResponse } from "@pako/shared";
import { Plus, Printer, X } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

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
import { useCompanyMembers } from "@/hooks/usePosServices";
import { useItemSearch } from "@/hooks/useStock";
import { useUrlParam } from "@/hooks/useUrlParam";
import { COUPON_PRINT_CSS } from "@/lib/pos-print";
import { REPAIR_STATES, RepairState, localDate, localTime, pickTillRegister, repairStateKey } from "@/lib/pos-services";
import { printElement } from "@/lib/print";
import { cn } from "@/lib/utils";

const GRID_ID = "pos-repairs";
const ALL = "all";
const money = (v: number) => v.toFixed(2);
// The way a repair goes; Collected is reached only by the sale at the till, Cancelled any time before.
const FLOW = [RepairState.Received, RepairState.Diagnosing, RepairState.WaitingApproval, RepairState.Approved, RepairState.InRepair, RepairState.Ready];
const isClosed = (r: RepairTicketResponse) => r.state === RepairState.Collected || r.state === RepairState.Cancelled;

// docs/POS_PLAN.md §6.9 / P4: repair tickets — intake with the accessories left, an estimate, the
// status along the way (the server e-mails the customer at "waiting approval" and "ready"), and
// collection at the till. Amounts are the server's.
export function Repairs() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [state, setState] = useUrlParam("state", ALL, [`${GRID_ID}.page`]);
  const [opened, setOpened] = useState<RepairTicketResponse | "new" | null>(null);

  const repairs = useQuery({
    queryKey: ["posRepairs", activeCompanyId, state, grid.globalFilter, grid.page, grid.pageSize],
    queryFn: () => apiClient.listPosRepairs(activeCompanyId as string, state === ALL ? undefined : Number(state), grid.globalFilter || undefined, grid.page, grid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<RepairTicketResponse>[]>(
    () => [
      { accessorKey: "number", header: t("svc.repair.number"), cell: ({ getValue }) => <span className="tabular-nums">{getValue() as string}</span> },
      { id: "createdAt", header: t("svc.repair.received"), accessorFn: (r) => `${localDate(r.createdAt)} ${localTime(r.createdAt)}` },
      { accessorKey: "customerName", header: t("svc.appt.customerName") },
      { id: "phone", header: t("svc.phone"), accessorFn: (r) => r.phone ?? "—" },
      { accessorKey: "device", header: t("svc.repair.device") },
      { id: "serial", header: t("svc.repair.serial"), accessorFn: (r) => r.serialOrPlate ?? "—" },
      {
        id: "state",
        header: t("svc.status"),
        accessorFn: (r) => t(`svc.repair.state.${repairStateKey(r.state)}`),
        cell: ({ row, getValue }) => (
          <Badge variant={row.original.state === RepairState.Ready ? "default" : isClosed(row.original) ? "secondary" : "outline"}>{getValue() as string}</Badge>
        ),
      },
      { accessorKey: "estimateTotal", header: t("svc.repair.estimate"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("svc.nav.repairs")}</CardTitle>
          <CardDescription>{t("svc.nav.repairs.description")}</CardDescription>
        </div>
        {canWrite("pos") && (
          <Button size="sm" onClick={() => setOpened("new")}>
            <Plus className="size-4" />
            {t("svc.repair.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex w-56 flex-col gap-1">
          <Label htmlFor="repair-state-filter">{t("svc.status")}</Label>
          <Select
            id="repair-state-filter"
            value={state}
            onValueChange={setState}
            options={[
              { value: ALL, label: t("svc.repair.state.all") },
              ...REPAIR_STATES.map((s) => ({ value: String(s), label: t(`svc.repair.state.${repairStateKey(s)}`) })),
            ]}
          />
        </div>
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={repairs.data?.items ?? []}
          rowCount={repairs.data?.total ?? 0}
          isLoading={repairs.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => (r.state === RepairState.Cancelled ? "text-muted-foreground line-through" : r.state === RepairState.Collected ? "text-muted-foreground" : undefined)}
          onRowClick={setOpened}
          enableGlobalFilter
          globalFilterPlaceholder={t("svc.repair.search")}
          emptyMessage={t("svc.repair.empty")}
          exportFileName="repairs"
        />
      </CardContent>
      {opened && (
        <RepairDialog
          ticket={opened === "new" ? null : opened}
          onClose={() => setOpened(null)}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ["posRepairs", activeCompanyId] })}
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

export function RepairDialog({ ticket: initial, onClose, onChanged }: { ticket: RepairTicketResponse | null; onClose: () => void; onChanged: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const navigate = useNavigate();
  const allStores = usePosStores().data ?? [];
  const registers = usePosRegisters().data ?? [];
  const members = useCompanyMembers().data ?? [];
  const itemSearch = useItemSearch();
  const customers = (useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []).filter((p) => p.isCustomer || p.id === initial?.customerId);

  const [ticket, setTicket] = useState<RepairTicketResponse | null>(initial);
  const stores = allStores.filter((s) => s.isActive || s.id === ticket?.storeId);
  const [storeId, setStoreId] = useState(initial?.storeId ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [customerName, setCustomerName] = useState(initial?.customerName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [device, setDevice] = useState(initial?.device ?? "");
  const [serial, setSerial] = useState(initial?.serialOrPlate ?? "");
  const [problem, setProblem] = useState(initial?.problem ?? "");
  const [accessories, setAccessories] = useState(initial?.accessories ?? "");
  const [technician, setTechnician] = useState(initial?.technicianUserId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    () => initial?.lines.map((l) => ({ key: l.id, itemId: l.itemId, description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<"a4" | "80mm">("a4");
  const receiptRef = useRef<HTMLDivElement>(null);
  const effectiveStoreId = storeId || stores[0]?.id || "";
  const closed = !!ticket && isClosed(ticket);
  const write = canWrite("pos") && !closed;

  const itemOptions = useMemo(() => {
    const options = itemSearch.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.unit }));
    const listed = new Set(options.map((o) => o.value));
    for (const l of lines) if (l.itemId && !listed.has(l.itemId) && l.description) options.push({ value: l.itemId, label: l.description, description: "" });
    return options;
  }, [itemSearch.items, lines]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        storeId: effectiveStoreId, customerName: customerName.trim(), device: device.trim(), problem: problem.trim(),
        customerId: customerId || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined,
        serialOrPlate: serial.trim() || undefined, accessories: accessories.trim() || undefined, technicianUserId: technician || undefined,
        notes: notes.trim() || undefined,
        // An empty price takes the store's price on the day.
        lines: lines
          .filter((l) => l.itemId)
          .map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: l.unitPrice.trim() ? Number(l.unitPrice) : undefined })),
      };
      return ticket ? apiClient.updatePosRepair(activeCompanyId as string, ticket.id, body) : apiClient.createPosRepair(activeCompanyId as string, body);
    },
    onSuccess: (saved) => {
      setError(null);
      setTicket(saved);
      setLines(saved.lines.map((l) => ({ key: l.id, itemId: l.itemId, description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })));
      onChanged();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const setState = useMutation({
    mutationFn: (state: number) => apiClient.setPosRepairState(activeCompanyId as string, (ticket as RepairTicketResponse).id, { state }),
    onSuccess: (saved) => {
      setError(null);
      setTicket(saved);
      onChanged();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const patch = (key: string, change: Partial<LineDraft>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l)));
  const valid = !!effectiveStoreId && !!customerName.trim() && !!device.trim() && !!problem.trim() && lines.every((l) => !l.itemId || Number(l.quantity) > 0);
  const store = allStores.find((s) => s.id === (ticket?.storeId ?? effectiveStoreId));
  const till = ticket ? pickTillRegister(registers, ticket.storeId) : undefined;

  return (
    <FormDialog open onOpenChange={(open) => !open && !save.isPending && onClose()} title={ticket ? `${ticket.number} · ${ticket.device}` : t("svc.repair.new")} size="lg">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {ticket && (
          <div className="flex flex-col gap-2 rounded-md border p-2" data-testid="repair-flow">
            <div className="flex flex-wrap items-center gap-1">
              {FLOW.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="xs"
                  variant={ticket.state === s ? "default" : "outline"}
                  disabled={!write || ticket.state === s || setState.isPending}
                  onClick={() => setState.mutate(s)}
                >
                  {t(`svc.repair.state.${repairStateKey(s)}`)}
                </Button>
              ))}
              {(ticket.state === RepairState.Collected || ticket.state === RepairState.Cancelled) && (
                <Badge variant="secondary">{t(`svc.repair.state.${repairStateKey(ticket.state)}`)}</Badge>
              )}
              {write && (
                <Button type="button" size="xs" variant="ghost" className="ml-auto text-destructive" disabled={setState.isPending} onClick={() => setState.mutate(RepairState.Cancelled)}>
                  {t("svc.repair.cancel")}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{ticket.email ? t("svc.repair.flow.hint") : t("svc.repair.flow.noEmail")}</p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-store">{t("pos.register.store")}</Label>
            <Select id="rp-store" value={effectiveStoreId} onValueChange={setStoreId} disabled={!write} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="rp-customer">{t("svc.appt.partner")}</Label>
            <SearchableSelect
              id="rp-customer"
              value={customerId}
              disabled={!write}
              onChange={(v) => {
                setCustomerId(v);
                const partner = customers.find((p) => p.id === v);
                if (partner && !customerName.trim()) setCustomerName(partner.name);
              }}
              placeholder={t("svc.appt.partner.none")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              emptyOptionLabel={t("svc.appt.partner.none")}
              options={customers.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-name">{t("svc.appt.customerName")}</Label>
            <Input id="rp-name" required disabled={!write} maxLength={120} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-phone">{t("svc.phone")}</Label>
            <Input id="rp-phone" type="tel" disabled={!write} maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-email">{t("svc.email")}</Label>
            <Input id="rp-email" type="email" disabled={!write} maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-device">{t("svc.repair.device")}</Label>
            <Input id="rp-device" required disabled={!write} maxLength={120} value={device} onChange={(e) => setDevice(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-serial">{t("svc.repair.serial")}</Label>
            <Input id="rp-serial" disabled={!write} maxLength={60} value={serial} onChange={(e) => setSerial(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-tech">{t("svc.repair.technician")}</Label>
            <SearchableSelect
              id="rp-tech"
              value={technician}
              disabled={!write}
              onChange={setTechnician}
              placeholder={t("svc.repair.technician.none")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              emptyOptionLabel={t("svc.repair.technician.none")}
              options={[
                ...members.map((m) => ({ value: m.userId, label: m.email })),
                ...(technician && !members.some((m) => m.userId === technician) ? [{ value: technician, label: technician }] : []),
              ]}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-problem">{t("svc.repair.problem")}</Label>
            <Textarea id="rp-problem" required disabled={!write} rows={3} maxLength={1000} value={problem} onChange={(e) => setProblem(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-accessories">{t("svc.repair.accessories")}</Label>
            <Textarea id="rp-accessories" disabled={!write} rows={3} maxLength={500} placeholder={t("svc.repair.accessories.placeholder")} value={accessories} onChange={(e) => setAccessories(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rp-notes">{t("svc.notes")}</Label>
          <Textarea id="rp-notes" disabled={!write} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <p className="text-sm font-medium">{t("svc.repair.lines")}</p>
        <ul className="flex flex-col gap-2">
          {lines.map((l) => {
            const savedLine = ticket?.lines.find((x) => x.id === l.key);
            return (
              <li key={l.key} className="grid grid-cols-[1fr_6rem_7rem_6rem_auto] items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs" htmlFor={`rp-item-${l.key}`}>{t("pos.customerOrder.item")}</Label>
                  <SearchableSelect
                    id={`rp-item-${l.key}`}
                    value={l.itemId}
                    disabled={!write}
                    onChange={(v) => patch(l.key, { itemId: v })}
                    onSearchChange={itemSearch.onSearchChange}
                    placeholder={t("pos.customerOrder.item.pick")}
                    searchPlaceholder={t("common.search")}
                    noResultsText={t("common.noResults")}
                    options={itemOptions}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs" htmlFor={`rp-qty-${l.key}`}>{t("pos.customerOrder.quantity")}</Label>
                  <Input id={`rp-qty-${l.key}`} type="number" min={0.001} step="any" disabled={!write} className="text-right tabular-nums" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs" htmlFor={`rp-price-${l.key}`}>{t("pos.customerOrder.unitPrice")}</Label>
                  <Input
                    id={`rp-price-${l.key}`}
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={!write}
                    placeholder={t("pos.customerOrder.unitPrice.store")}
                    className="text-right tabular-nums"
                    value={l.unitPrice}
                    onChange={(e) => patch(l.key, { unitPrice: e.target.value })}
                  />
                </div>
                {/* The saved line's amount, as the server worked it out. */}
                <span className="pb-2 text-right text-sm tabular-nums">{savedLine ? money(savedLine.amount) : "—"}</span>
                <Button type="button" size="sm" variant="ghost" disabled={!write} aria-label={t("till.remove")} onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
        {write && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => setLines((all) => [...all, { key: crypto.randomUUID(), itemId: "", quantity: "1", unitPrice: "" }])}
          >
            <Plus className="size-4" /> {t("pos.customerOrder.addLine")}
          </Button>
        )}
        {ticket && (
          <p className="flex justify-between text-sm font-semibold tabular-nums">
            <span>{t("svc.repair.estimateTotal")}</span>
            <span data-testid="repair-estimate">{money(ticket.estimateTotal)}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {ticket && (
            <>
              <Select
                id="rp-format"
                aria-label={t("svc.repair.printFormat")}
                value={format}
                onValueChange={(v) => setFormat(v as "a4" | "80mm")}
                options={[{ value: "a4", label: "A4" }, { value: "80mm", label: "80 mm" }]}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => receiptRef.current && printElement(receiptRef.current, format === "80mm" ? { extraCss: COUPON_PRINT_CSS } : undefined)}
              >
                <Printer className="size-4" /> {t("svc.repair.print")}
              </Button>
            </>
          )}
          {ticket && canWrite("pos") && !closed && (
            <Button
              type="button"
              variant={ticket.state === RepairState.Ready ? "default" : "outline"}
              onClick={() => (till ? navigate(`/pos/till/${till.id}?repair=${ticket.id}`) : setError(t("svc.noTill")))}
            >
              {t("svc.repair.collect")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("svc.close")}</Button>
          {write && <Button type="submit" disabled={!valid || save.isPending}>{ticket ? t("common.save") : t("svc.repair.intake")}</Button>}
        </div>
      </form>
      {/* The intake receipt, printed in its own frame; kept off screen. */}
      {ticket && (
        <div className="sr-only" aria-hidden>
          <RepairReceipt ref={receiptRef} ticket={ticket} store={store} narrow={format === "80mm"} />
        </div>
      )}
    </FormDialog>
  );
}

export const RepairReceipt = forwardRef<HTMLDivElement, { ticket: RepairTicketResponse; store?: StoreResponse; narrow?: boolean }>(function RepairReceipt(
  { ticket: r, store, narrow },
  ref,
) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const row = (label: string, value: string | undefined) =>
    value ? (
      <div className={cn("flex gap-2", narrow ? "flex-col" : "")}>
        <span className="min-w-32 font-semibold">{label}</span>
        <span className="whitespace-pre-wrap">{value}</span>
      </div>
    ) : null;
  return (
    <div ref={ref} className={cn("flex flex-col gap-2 bg-white p-2 text-black", narrow ? "w-[74mm] text-[11px]" : "text-sm")}>
      <div className="text-center">
        {store && <div className="text-base font-bold">{store.name}</div>}
        {store?.address && <div>{store.address}</div>}
        <div className="mt-1 text-lg font-bold">{t("svc.repair.receipt.title", { number: r.number })}</div>
        <div>{localDate(r.createdAt)} {localTime(r.createdAt)}</div>
      </div>
      {row(t("svc.appt.customerName"), r.customerName)}
      {row(t("svc.phone"), r.phone)}
      {row(t("svc.repair.device"), r.device)}
      {row(t("svc.repair.serial"), r.serialOrPlate)}
      {row(t("svc.repair.problem"), r.problem)}
      {row(t("svc.repair.accessories"), r.accessories ?? t("svc.repair.accessories.none"))}
      {r.lines.length > 0 && (
        <div className="flex flex-col border-t pt-1">
          <span className="font-semibold">{t("svc.repair.lines")}</span>
          {r.lines.map((l) => (
            <div key={l.id} className="flex justify-between gap-2 tabular-nums">
              <span>{l.description} × {intl.formatNumber(l.quantity)}</span>
              <span>{money(l.amount)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between border-t pt-1 font-bold tabular-nums">
        <span>{t("svc.repair.estimateTotal")}</span>
        <span>{money(r.estimateTotal)}</span>
      </div>
      <p className="text-xs">{t("svc.repair.receipt.terms")}</p>
      <div className={cn("mt-8 grid gap-8", narrow ? "grid-cols-1" : "grid-cols-2")}>
        <div className="border-t border-black pt-1 text-center text-xs">{t("svc.repair.receipt.customerSignature")}</div>
        <div className="border-t border-black pt-1 text-center text-xs">{t("svc.repair.receipt.staffSignature")}</div>
      </div>
    </div>
  );
});
