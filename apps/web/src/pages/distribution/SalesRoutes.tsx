import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { SalesRouteResponse, SaveSalesRouteRequest } from "@pako/shared";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
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
import { usePartners } from "@/hooks/useDistribution";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useCompanyMembers } from "@/hooks/usePosServices";
import { useWarehouses } from "@/hooks/useStock";
import { WEEK_DAYS, dayBit, hasDay } from "@/lib/sales-order-enums";

interface Stop {
  partnerId: string;
  notes: string;
}

// docs/POS_PLAN.md P6 — sales routes: which customers a salesperson (and their van) visits on which
// days, in order.
export function SalesRoutes() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const members = useCompanyMembers().data ?? [];
  const [editing, setEditing] = useState<SalesRouteResponse | "new" | null>(null);
  const query = useQuery({
    queryKey: ["salesRoutes", activeCompanyId],
    queryFn: () => apiClient.listSalesRoutes(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const routes = query.data ?? [];

  const columns = useMemo<ColumnDef<SalesRouteResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("dist.route.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("dist.route.inactive")}</Badge>}
          </span>
        ),
      },
      {
        id: "salesperson",
        header: t("dist.route.salesperson"),
        accessorFn: (r) => (r.userId ? members.find((m) => m.userId === r.userId)?.email ?? r.userId : "—"),
      },
      { accessorKey: "warehouseName", header: t("dist.van"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      {
        accessorKey: "days",
        header: t("dist.route.days"),
        cell: ({ getValue }) => WEEK_DAYS.filter((d) => hasDay(getValue() as number, d)).map((d) => t(`dist.day.short.${d}`)).join(" "),
      },
      { id: "stops", header: t("dist.route.stops"), meta: { numeric: true }, accessorFn: (r) => r.stops.length },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, members],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("nav.salesRoutes")}</CardTitle>
          <CardDescription>{t("nav.salesRoutes.description")}</CardDescription>
        </div>
        {canWrite("sales") && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("dist.route.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataGrid
          gridId="sales-routes"
          columns={columns}
          data={routes}
          rowCount={routes.length}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => (r.isActive ? undefined : "text-muted-foreground")}
          onRowClick={canWrite("sales") ? setEditing : undefined}
          enableGlobalFilter
          emptyMessage={t("dist.route.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
      {editing && (
        <RouteDialog
          route={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["salesRoutes", activeCompanyId] });
          }}
        />
      )}
    </Card>
  );
}

function RouteDialog({ route, onClose, onSaved }: { route: SalesRouteResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const members = useCompanyMembers().data ?? [];
  const vans = (useWarehouses().data ?? []).filter((w) => w.isVan && (w.isActive || w.id === route?.warehouseId));
  const customers = (usePartners().data ?? []).filter((p) => p.isCustomer);
  const [name, setName] = useState(route?.name ?? "");
  const [userId, setUserId] = useState(route?.userId ?? "");
  const [warehouseId, setWarehouseId] = useState(route?.warehouseId ?? "");
  const [days, setDays] = useState(route?.days ?? 0);
  const [isActive, setIsActive] = useState(route?.isActive ?? true);
  const [stops, setStops] = useState<Stop[]>(
    [...(route?.stops ?? [])].sort((a, b) => a.sequence - b.sequence).map((s) => ({ partnerId: s.partnerId, notes: s.notes ?? "" })),
  );
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const partnerName = (id: string) => customers.find((c) => c.id === id)?.name ?? route?.stops.find((s) => s.partnerId === id)?.partnerName ?? id;

  const save = useMutation({
    mutationFn: () => {
      const body: SaveSalesRouteRequest = {
        name: name.trim(),
        userId: userId || undefined,
        warehouseId: warehouseId || undefined,
        days,
        isActive,
        stops: stops.map((s) => ({ partnerId: s.partnerId, notes: s.notes.trim() || undefined })),
      };
      return route
        ? apiClient.updateSalesRoute(activeCompanyId as string, route.id, body)
        : apiClient.createSalesRoute(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("dist.route.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  function addStop(partnerId: string) {
    if (!partnerId) return;
    setStops((s) => (s.some((x) => x.partnerId === partnerId) ? s : [...s, { partnerId, notes: "" }]));
    setAdding("");
  }

  function move(index: number, by: number) {
    setStops((s) => {
      const next = [...s];
      const target = index + by;
      if (target < 0 || target >= next.length) return s;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={route ? route.name : t("dist.route.new")} size="md">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="route-name">{t("dist.route.name")}</Label>
          <Input id="route-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="route-user">{t("dist.route.salesperson")}</Label>
            <SearchableSelect id="route-user" value={userId} onChange={setUserId} placeholder={t("dist.route.nobody")}
              emptyOptionLabel={t("dist.route.nobody")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")}
              options={[
                ...members.map((m) => ({ value: m.userId, label: m.email })),
                ...(userId && !members.some((m) => m.userId === userId) ? [{ value: userId, label: userId }] : []),
              ]} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="route-van">{t("dist.van")}</Label>
            <Select id="route-van" value={warehouseId} onValueChange={setWarehouseId}
              options={[{ value: "", label: t("dist.route.noVan") }, ...vans.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))]} />
          </div>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t("dist.route.days")}</legend>
          <div className="flex flex-wrap gap-3">
            {WEEK_DAYS.map((d) => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={hasDay(days, d)} onChange={(e) => setDays((v) => (e.target.checked ? v | dayBit(d) : v & ~dayBit(d)))} />
                {t(`dist.day.${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("dist.route.stops")}</h3>
          {stops.length === 0 && <p className="text-xs text-muted-foreground">{t("dist.route.noStops")}</p>}
          <ol className="flex flex-col gap-1.5">
            {stops.map((stop, index) => (
              <li key={stop.partnerId} className="grid grid-cols-[1.5rem_minmax(8rem,1fr)_minmax(8rem,1fr)_auto] items-center gap-2">
                <span className="text-right text-xs text-muted-foreground tnum">{index + 1}.</span>
                <span className="truncate text-sm">{partnerName(stop.partnerId)}</span>
                <Input className="h-8" placeholder={t("dist.route.stopNotes")} aria-label={t("dist.route.stopNotes")} value={stop.notes}
                  onChange={(e) => setStops((s) => s.map((x, i) => (i === index ? { ...x, notes: e.target.value } : x)))} />
                <span className="flex gap-0.5">
                  <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={t("dist.route.moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={t("dist.route.moveDown")} disabled={index === stops.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={t("dashboard.edit.remove")} onClick={() => setStops((s) => s.filter((_, i) => i !== index))}>
                    <X className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          <SearchableSelect value={adding} onChange={addStop} aria-label={t("dist.route.addStop")} placeholder={t("dist.route.addStop")}
            searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")}
            options={customers.filter((c) => !stops.some((s) => s.partnerId === c.id)).map((c) => ({ value: c.id, label: c.name }))} />
        </section>
        {route && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("dist.route.active")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !name.trim()}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
