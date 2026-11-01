import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ResourceHoursResponse, ResourceResponse } from "@pako/shared";
import { Plus, X } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosStores } from "@/hooks/usePos";
import { useItemSearch } from "@/hooks/useStock";
import { resourcesKey, useCompanyMembers } from "@/hooks/usePosServices";
import { useUrlParam } from "@/hooks/useUrlParam";
import { RESOURCE_KINDS, ResourceKind, WEEKDAYS, minutesOf, resourceKindKey } from "@/lib/pos-services";

const GRID_ID = "pos-resources";
const ALL = "all";
const hhmm = (time: string) => time.slice(0, 5);

// docs/POS_PLAN.md P4: who and what appointments are booked with — staff, rooms, equipment — their
// weekly hours and the services each performs. Approve to edit.
export function PosResources() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const stores = usePosStores().data ?? [];
  const members = useCompanyMembers().data ?? [];
  const [store, setStore] = useUrlParam("store", ALL);
  const [editing, setEditing] = useState<ResourceResponse | "new" | null>(null);
  const canEdit = canApprove("pos");

  const resources = useQuery({
    queryKey: resourcesKey(activeCompanyId, store === ALL ? undefined : store),
    queryFn: () => apiClient.listPosResources(activeCompanyId as string, store === ALL ? undefined : store),
    enabled: !!activeCompanyId,
  });

  const columns = useMemo<ColumnDef<ResourceResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("svc.resource.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="inline-block size-3 rounded-full border" style={{ backgroundColor: row.original.color ?? "transparent" }} />
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { id: "store", header: t("pos.register.store"), accessorFn: (r) => stores.find((s) => s.id === r.storeId)?.name ?? "—" },
      { id: "kind", header: t("svc.resource.kind"), accessorFn: (r) => t(`svc.resource.kind.${resourceKindKey(r.kind)}`) },
      { id: "member", header: t("svc.resource.member"), accessorFn: (r) => (r.userId ? members.find((m) => m.userId === r.userId)?.email ?? r.userId : "—") },
      {
        id: "hours",
        header: t("svc.resource.hours"),
        enableSorting: false,
        accessorFn: (r) =>
          r.hours.map((h) => `${t(`svc.weekday.short.${h.day}`)} ${hhmm(h.from)}–${hhmm(h.to)}`).join(", ") || "—",
      },
      { id: "services", header: t("svc.resource.services"), meta: { numeric: true }, accessorFn: (r) => r.serviceItemIds.length },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, stores, members],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const rows = resources.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("svc.nav.resources")}</CardTitle>
          <CardDescription>{t("svc.nav.resources.description")}</CardDescription>
        </div>
        {canEdit && stores.length > 0 && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("svc.resource.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex w-56 flex-col gap-1">
          <Label htmlFor="res-store-filter">{t("pos.register.store")}</Label>
          <Select
            id="res-store-filter"
            value={store}
            onValueChange={setStore}
            options={[{ value: ALL, label: t("svc.allStores") }, ...stores.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </div>
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={resources.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => (r.isActive ? undefined : "text-muted-foreground")}
          onRowClick={canEdit ? setEditing : undefined}
          emptyMessage={t("svc.resource.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
      {editing && (
        <ResourceDialog
          resource={editing === "new" ? null : editing}
          defaultStoreId={store === ALL ? stores[0]?.id ?? "" : store}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["posResources", activeCompanyId] });
          }}
        />
      )}
    </Card>
  );
}

interface SpanDraft {
  key: string;
  day: number;
  from: string;
  to: string;
}

function ResourceDialog({ resource, defaultStoreId, onClose, onSaved }: {
  resource: ResourceResponse | null;
  defaultStoreId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const stores = (usePosStores().data ?? []).filter((s) => s.isActive || s.id === resource?.storeId);
  const members = useCompanyMembers().data ?? [];
  const itemSearch = useItemSearch();
  const [storeId, setStoreId] = useState(resource?.storeId ?? defaultStoreId);
  const [name, setName] = useState(resource?.name ?? "");
  const [kind, setKind] = useState(String(resource?.kind ?? ResourceKind.Staff));
  const [userId, setUserId] = useState(resource?.userId ?? "");
  const [color, setColor] = useState(resource?.color ?? "");
  const [isActive, setIsActive] = useState(resource?.isActive ?? true);
  const [spans, setSpans] = useState<SpanDraft[]>(
    () => resource?.hours.map((h) => ({ key: crypto.randomUUID(), day: h.day, from: hhmm(h.from), to: hhmm(h.to) })) ?? [],
  );
  const [services, setServices] = useState<string[]>(resource?.serviceItemIds ?? []);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The saved services, named even before a search returns them.
  const saved = useQuery({
    queryKey: ["items", activeCompanyId, "resourceServices", resource?.id],
    queryFn: () => Promise.all((resource as ResourceResponse).serviceItemIds.map((id) => apiClient.itemsGET2(activeCompanyId as string, id))),
    enabled: !!activeCompanyId && !!resource && resource.serviceItemIds.length > 0,
  }).data ?? [];
  const nameOf = (id: string) => {
    const item = itemSearch.items.find((i) => i.id === id) ?? saved.find((i) => i.id === id);
    return item ? `${item.code} · ${item.name}` : "…";
  };
  const serviceOptions = itemSearch.items
    .filter((i) => i.isBookable && !services.includes(i.id))
    .map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.durationMinutes ? t("svc.minutes", { n: i.durationMinutes }) : undefined }));

  const spansValid = spans.every((s) => s.from && s.to && minutesOf(s.to) > minutesOf(s.from));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        storeId, name: name.trim(), kind: Number(kind), userId: userId || undefined, color: color || undefined, isActive,
        hours: spans.map((s): ResourceHoursResponse => ({ day: s.day, from: `${s.from}:00`, to: `${s.to}:00` })),
        serviceItemIds: services,
      };
      return resource
        ? apiClient.updatePosResource(activeCompanyId as string, resource.id, body)
        : apiClient.createPosResource(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!spansValid) {
      setError(t("svc.resource.hours.invalid"));
      return;
    }
    save.mutate();
  }

  const patch = (key: string, change: Partial<SpanDraft>) => setSpans((all) => all.map((s) => (s.key === key ? { ...s, ...change } : s)));

  return (
    <FormDialog open onOpenChange={(open) => !open && !save.isPending && onClose()} title={resource ? resource.name : t("svc.resource.new")} size="lg">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="res-store">{t("pos.register.store")}</Label>
            <Select id="res-store" value={storeId} onValueChange={setStoreId} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="res-name">{t("svc.resource.name")}</Label>
            <Input id="res-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="res-kind">{t("svc.resource.kind")}</Label>
            <Select
              id="res-kind"
              value={kind}
              onValueChange={setKind}
              options={RESOURCE_KINDS.map((k) => ({ value: String(k), label: t(`svc.resource.kind.${resourceKindKey(k)}`) }))}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="res-member">{t("svc.resource.member")}</Label>
            <SearchableSelect
              id="res-member"
              value={userId}
              onChange={setUserId}
              placeholder={t("svc.resource.member.none")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              emptyOptionLabel={t("svc.resource.member.none")}
              options={[
                ...members.map((m) => ({ value: m.userId, label: m.email })),
                ...(userId && !members.some((m) => m.userId === userId) ? [{ value: userId, label: userId }] : []),
              ]}
            />
            <p className="text-xs text-muted-foreground">{t("svc.resource.member.hint")}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="res-color">{t("svc.resource.color")}</Label>
            <div className="flex items-center gap-2">
              <Input id="res-color" type="color" className="h-9 w-16 p-1" value={color || "#64748b"} onChange={(e) => setColor(e.target.value)} />
              {color && (
                <Button type="button" size="xs" variant="ghost" onClick={() => setColor("")}>{t("svc.resource.color.clear")}</Button>
              )}
            </div>
          </div>
        </div>

        <p className="text-sm font-medium">{t("svc.resource.hours")}</p>
        <ul className="flex flex-col gap-2">
          {spans.map((s) => (
            <li key={s.key} className="grid grid-cols-[10rem_7rem_7rem_auto] items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs" htmlFor={`res-day-${s.key}`}>{t("svc.resource.day")}</Label>
                <Select
                  id={`res-day-${s.key}`}
                  value={String(s.day)}
                  onValueChange={(v) => patch(s.key, { day: Number(v) })}
                  options={WEEKDAYS.map((d) => ({ value: String(d), label: t(`svc.weekday.${d}`) }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs" htmlFor={`res-from-${s.key}`}>{t("svc.resource.from")}</Label>
                <Input id={`res-from-${s.key}`} type="time" step={900} required value={s.from} onChange={(e) => patch(s.key, { from: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs" htmlFor={`res-to-${s.key}`}>{t("svc.resource.to")}</Label>
                <Input id={`res-to-${s.key}`} type="time" step={900} required value={s.to} onChange={(e) => patch(s.key, { to: e.target.value })} />
              </div>
              <Button type="button" size="sm" variant="ghost" aria-label={t("till.remove")} onClick={() => setSpans((all) => all.filter((x) => x.key !== s.key))}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const last = spans[spans.length - 1];
              setSpans((all) => [...all, { key: crypto.randomUUID(), day: last ? Math.min(6, last.day + 1) : 0, from: last?.from ?? "09:00", to: last?.to ?? "17:00" }]);
            }}
          >
            <Plus className="size-4" /> {t("svc.resource.addSpan")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              const first = spans[0];
              // Mon–Fri like the first span (or 09:00–17:00), replacing what is there.
              setSpans([0, 1, 2, 3, 4].map((day) => ({ key: crypto.randomUUID(), day, from: first?.from ?? "09:00", to: first?.to ?? "17:00" })));
            }}
          >
            {t("svc.resource.weekdays")}
          </Button>
        </div>

        <p className="text-sm font-medium">{t("svc.resource.services")}</p>
        <div className="flex flex-wrap gap-1" data-testid="resource-services">
          {services.length === 0 && <span className="text-sm text-muted-foreground">{t("svc.resource.services.none")}</span>}
          {services.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              {nameOf(id)}
              <button type="button" aria-label={t("pos.setup3.removeItem", { name: nameOf(id) })} onClick={() => setServices((all) => all.filter((x) => x !== id))}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex max-w-md flex-col gap-1">
          <Label htmlFor="res-service-add">{t("svc.resource.addService")}</Label>
          <SearchableSelect
            id="res-service-add"
            value={pick}
            onChange={(v) => {
              if (v) setServices((all) => (all.includes(v) ? all : [...all, v]));
              setPick("");
            }}
            onSearchChange={itemSearch.onSearchChange}
            placeholder={t("svc.resource.addService.pick")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("svc.resource.addService.noBookable")}
            options={serviceOptions}
          />
        </div>

        {resource && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("common.active")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !storeId || !name.trim()}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
