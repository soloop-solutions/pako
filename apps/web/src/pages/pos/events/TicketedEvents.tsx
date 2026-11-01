import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { SaveTicketedEventRequest, TicketedEventResponse } from "@pako/shared";
import { Plus, ScanLine, X } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useItemLookup } from "@/hooks/useItemLookup";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosStores } from "@/hooks/usePos";
import { ErrorAlert, Field } from "@/pages/pos/hotel/hotel-shared";
import { VENUE_TIME_ZONE, utcToZonedInput, zonedInputToUtc } from "@/pages/pos/hotel/hotel-utils";
import { ItemPicker } from "@/pages/pos/menuPickers";

const ticketedKey = (companyId: string | null) => ["posTicketedEvents", companyId] as const;

interface TypeDraft {
  key: string;
  itemId: string;
  quota: string;
  sold: number;
}

// docs/POS_PLAN.md §6.5 / P5: ticketed events — a concert or a party with a capacity, and the
// ticket items the till sells for it (each with an optional quota). The till prints each ticket
// with its QR; the door scanner (/pos/scan) lets each one in once. Sold and used are the server's.
export function TicketedEvents() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const canEdit = canApprove("pos");
  const queryClient = useQueryClient();
  const stores = usePosStores().data ?? [];
  const [editing, setEditing] = useState<TicketedEventResponse | "new" | null>(null);

  const eventsQuery = useQuery({
    queryKey: ticketedKey(activeCompanyId),
    queryFn: () => apiClient.listPosTicketedEvents(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);

  const columns = useMemo<ColumnDef<TicketedEventResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("hotel.ticketed.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      {
        id: "startsAt",
        header: t("hotel.ticketed.startsAt"),
        accessorFn: (e) => e.startsAt,
        cell: ({ row }) => intl.formatDate(row.original.startsAt, { timeZone: VENUE_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }),
      },
      { id: "store", header: t("pos.register.store"), accessorFn: (e) => stores.find((s) => s.id === e.storeId)?.name ?? "" },
      { accessorKey: "capacity", header: t("hotel.ticketed.capacity"), meta: { numeric: true } },
      { accessorKey: "sold", header: t("hotel.ticketed.sold"), meta: { numeric: true } },
      { accessorKey: "used", header: t("hotel.ticketed.used"), meta: { numeric: true } },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex justify-end">
            <Button
              size="xs"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/pos/scan?event=${row.original.id}`);
              }}
            >
              <ScanLine className="size-3" /> {t("hotel.scan.open")}
            </Button>
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, stores],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("hotel.nav.tickets")}</CardTitle>
          <CardDescription>{t("hotel.nav.tickets.description")}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/pos/scan")}>
            <ScanLine className="size-4" /> {t("hotel.scan.title")}
          </Button>
          {canEdit && stores.length > 0 && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" /> {t("hotel.ticketed.new")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {eventsQuery.error && <ErrorAlert message={getApiErrorMessage(eventsQuery.error, t("pos.saveError"))} />}
        <DataGrid
          gridId="pos-ticketed-events"
          columns={columns}
          data={events}
          rowCount={events.length}
          isLoading={eventsQuery.isPending}
          getRowId={(e) => e.id}
          getRowClassName={(e) => (e.isActive ? undefined : "text-muted-foreground")}
          onRowClick={canEdit ? setEditing : undefined}
          emptyMessage={t("hotel.ticketed.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
      {editing && (
        <TicketedEventDialog
          event={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ticketedKey(activeCompanyId) });
          }}
        />
      )}
    </Card>
  );
}

function TicketedEventDialog({ event, onClose, onSaved }: { event: TicketedEventResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const stores = (usePosStores().data ?? []).filter((s) => s.isActive || s.id === event?.storeId);
  const [storeId, setStoreId] = useState(event?.storeId ?? stores[0]?.id ?? "");
  const [name, setName] = useState(event?.name ?? "");
  const [startsAt, setStartsAt] = useState(event ? utcToZonedInput(event.startsAt) : "");
  const [capacity, setCapacity] = useState(String(event?.capacity ?? ""));
  const [isActive, setIsActive] = useState(event?.isActive ?? true);
  const [types, setTypes] = useState<TypeDraft[]>(() =>
    event?.ticketTypes.length
      ? event.ticketTypes.map((x) => ({ key: x.itemId, itemId: x.itemId, quota: x.quota != null ? String(x.quota) : "", sold: x.sold }))
      : [{ key: crypto.randomUUID(), itemId: "", quota: "", sold: 0 }],
  );
  const [error, setError] = useState<string | null>(null);
  const lookup = useItemLookup(types.map((x) => x.itemId));

  const save = useMutation({
    mutationFn: () => {
      const body: SaveTicketedEventRequest = {
        storeId,
        name: name.trim(),
        // Entered in Kosovo time, stored in UTC.
        startsAt: zonedInputToUtc(startsAt),
        capacity: Number(capacity),
        isActive,
        ticketTypes: types.filter((x) => x.itemId).map((x) => ({ itemId: x.itemId, quota: x.quota.trim() ? Number(x.quota) : undefined })),
      };
      return event ? apiClient.updatePosTicketedEvent(activeCompanyId as string, event.id, body) : apiClient.createPosTicketedEvent(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const patch = (key: string, change: Partial<TypeDraft>) => setTypes((all) => all.map((x) => (x.key === key ? { ...x, ...change } : x)));
  const chosen = types.filter((x) => x.itemId);
  const valid =
    !!storeId && !!name.trim() && !!zonedInputToUtc(startsAt) && /^\d{1,6}$/.test(capacity.trim()) && Number(capacity) >= 1 && chosen.length > 0 &&
    new Set(chosen.map((x) => x.itemId)).size === chosen.length && chosen.every((x) => x.quota.trim() === "" || (/^\d{1,6}$/.test(x.quota.trim()) && Number(x.quota) >= 1));

  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={event ? event.name : t("hotel.ticketed.new")} size="lg">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (valid) save.mutate();
        }}
      >
        <ErrorAlert message={error} />
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <Field id="te-name" label={t("hotel.ticketed.name")}>
            <Input id="te-name" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="te-store" label={t("pos.register.store")}>
            <Select id="te-store" value={storeId} onValueChange={setStoreId} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field id="te-starts" label={t("hotel.ticketed.startsAtLocal")}>
            <Input id="te-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field id="te-capacity" label={t("hotel.ticketed.capacity")}>
            <Input id="te-capacity" inputMode="numeric" className="text-right tabular-nums" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </div>
        <p className="text-sm font-medium">{t("hotel.ticketed.types")}</p>
        <p className="text-xs text-muted-foreground">{t("hotel.ticketed.types.hint")}</p>
        <ul className="flex flex-col gap-2">
          {types.map((x) => (
            <li key={x.key} className="grid grid-cols-[1fr_7rem_5rem_auto] items-end gap-2" data-testid="ticket-type">
              <Field id={`tt-item-${x.key}`} label={t("hotel.ticketed.item")}>
                <ItemPicker id={`tt-item-${x.key}`} lookup={lookup} value={x.itemId} onChange={(v) => patch(x.key, { itemId: v })} label={t("hotel.ticketed.item")} />
              </Field>
              <Field id={`tt-quota-${x.key}`} label={t("hotel.ticketed.quota")}>
                <Input
                  id={`tt-quota-${x.key}`}
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  placeholder={t("hotel.ticketed.quota.none")}
                  value={x.quota}
                  onChange={(e) => patch(x.key, { quota: e.target.value })}
                />
              </Field>
              <span className="pb-2 text-right text-sm tabular-nums text-muted-foreground">{t("hotel.ticketed.soldN", { count: x.sold })}</span>
              <Button type="button" size="sm" variant="ghost" aria-label={t("hotel.ticketed.removeType")} disabled={types.length === 1} onClick={() => setTypes((all) => all.filter((y) => y.key !== x.key))}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setTypes((all) => [...all, { key: crypto.randomUUID(), itemId: "", quota: "", sold: 0 }])}>
          <Plus className="size-4" /> {t("hotel.ticketed.addType")}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
