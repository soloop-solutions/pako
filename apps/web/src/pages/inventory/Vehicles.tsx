import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { VehicleResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useCompanyMembers } from "@/hooks/usePosServices";
import { useWarehouses } from "@/hooks/useStock";
import { VEHICLE_STATUSES, VEHICLE_TYPES, VehicleStatus, VehicleType } from "@/lib/vehicle-enums";

const vehiclesKey = (companyId: string | null, includeArchived: boolean) => ["vehicles", companyId, includeArchived] as const;

export function Vehicles() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const members = useCompanyMembers().data ?? [];
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<VehicleResponse | "new" | null>(null);

  const query = useQuery({
    queryKey: [...vehiclesKey(activeCompanyId, includeArchived), search],
    queryFn: () => apiClient.listVehicles(activeCompanyId as string, search.trim() || undefined, includeArchived, 1, 200),
    enabled: !!activeCompanyId,
  });

  const columns = useMemo<ColumnDef<VehicleResponse>[]>(
    () => [
      {
        accessorKey: "plate",
        header: t("vehicle.plate"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.plate}
            {row.original.isArchived && <Badge variant="secondary">{t("vehicle.archived")}</Badge>}
          </span>
        ),
      },
      { id: "vehicle", header: t("vehicle.makeModel"), accessorFn: (v) => [v.make, v.model].filter(Boolean).join(" ") || "—" },
      { id: "type", header: t("vehicle.type"), accessorFn: (v) => t(VEHICLE_TYPES[v.type]) },
      { id: "status", header: t("vehicle.status"), accessorFn: (v) => t(VEHICLE_STATUSES[v.status]) },
      {
        id: "driver",
        header: t("vehicle.driver"),
        accessorFn: (v) => (v.driverUserId ? (members.find((m) => m.userId === v.driverUserId)?.email ?? v.driverUserId) : "—"),
      },
      { id: "capacity", header: t("vehicle.capacityKg"), meta: { numeric: true }, accessorFn: (v) => (v.capacityKg == null ? "—" : intl.formatNumber(v.capacityKg)) },
      { id: "stock", header: t("vehicle.stockWarehouse"), accessorFn: (v) => v.stockWarehouseName ?? "—" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, members],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const vehicles = query.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("nav.vehicles")}</CardTitle>
            <CardDescription>{t("nav.vehicles.description")}</CardDescription>
          </div>
          {canWrite("inventory") && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("vehicle.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search")} aria-label={t("common.search")} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
              {t("vehicle.showArchived")}
            </label>
          </div>
          <DataGrid
            gridId="vehicles"
            columns={columns}
            data={vehicles}
            rowCount={vehicles.length}
            isLoading={query.isPending}
            getRowId={(v) => v.id}
            getRowClassName={(v) => (v.isArchived ? "text-muted-foreground" : undefined)}
            onRowClick={canWrite("inventory") ? setEditing : undefined}
            emptyMessage={t("vehicle.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
      {editing && <VehicleDialog vehicle={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function VehicleDialog({ vehicle, onClose }: { vehicle: VehicleResponse | null; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const members = useCompanyMembers().data ?? [];
  const warehouses = (useWarehouses().data ?? []).filter((w) => w.isActive);
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [type, setType] = useState(String(vehicle?.type ?? VehicleType.Van));
  const [status, setStatus] = useState(String(vehicle?.status ?? VehicleStatus.Active));
  const [driverUserId, setDriverUserId] = useState(vehicle?.driverUserId ?? "");
  const [capacity, setCapacity] = useState(vehicle?.capacityKg != null ? String(vehicle.capacityKg) : "");
  const [notes, setNotes] = useState(vehicle?.notes ?? "");
  const [stockMode, setStockMode] = useState<"none" | "create" | "link">(vehicle?.stockWarehouseId ? "link" : "none");
  const [stockWarehouseId, setStockWarehouseId] = useState(vehicle?.stockWarehouseId ?? "");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["vehicles", activeCompanyId] });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        plate: plate.trim(),
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        type: Number(type),
        status: Number(status),
        driverUserId: driverUserId || undefined,
        capacityKg: capacity.trim() ? Number(capacity.replace(",", ".")) : undefined,
        notes: notes.trim() || undefined,
        stockWarehouseId: stockMode === "link" ? stockWarehouseId || undefined : undefined,
        createStockWarehouse: stockMode === "create",
      };
      return vehicle
        ? apiClient.updateVehicle(activeCompanyId as string, vehicle.id, body)
        : apiClient.createVehicle(activeCompanyId as string, body);
    },
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "toast.vehicleSaved" }));
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["warehouses", activeCompanyId] });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vehicle.saveError"))),
  });

  const archive = useMutation({
    mutationFn: () => (vehicle!.isArchived
      ? apiClient.restoreVehicle(activeCompanyId as string, vehicle!.id)
      : apiClient.archiveVehicle(activeCompanyId as string, vehicle!.id)),
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "toast.vehicleSaved" }));
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["warehouses", activeCompanyId] });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vehicle.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const typeOptions = Object.entries(VEHICLE_TYPES).map(([value, key]) => ({ value, label: t(key) }));
  const statusOptions = Object.entries(VEHICLE_STATUSES).map(([value, key]) => ({ value, label: t(key) }));
  const stockLocked = !!vehicle?.stockWarehouseId;

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={vehicle ? vehicle.plate : t("vehicle.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="veh-plate">{t("vehicle.plate")}</Label>
            <Input id="veh-plate" required maxLength={20} value={plate} onChange={(e) => setPlate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="veh-type">{t("vehicle.type")}</Label>
            <Select id="veh-type" value={type} onValueChange={setType} options={typeOptions} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="veh-make">{t("vehicle.make")}</Label>
            <Input id="veh-make" maxLength={60} value={make} onChange={(e) => setMake(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="veh-model">{t("vehicle.model")}</Label>
            <Input id="veh-model" maxLength={60} value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="veh-status">{t("vehicle.status")}</Label>
            <Select id="veh-status" value={status} onValueChange={setStatus} options={statusOptions} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="veh-capacity">{t("vehicle.capacityKg")}</Label>
            <Input id="veh-capacity" inputMode="decimal" className="text-right tabular-nums" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="veh-driver">{t("vehicle.driver")}</Label>
          <SearchableSelect
            id="veh-driver"
            value={driverUserId}
            onChange={setDriverUserId}
            placeholder={t("dist.wh.noDriver")}
            emptyOptionLabel={t("dist.wh.noDriver")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("common.noResults")}
            options={[
              ...members.map((m) => ({ value: m.userId, label: m.email })),
              ...(driverUserId && !members.some((m) => m.userId === driverUserId) ? [{ value: driverUserId, label: driverUserId }] : []),
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="veh-stock">{t("vehicle.stockWarehouse")}</Label>
          <Select
            id="veh-stock"
            value={stockMode}
            disabled={stockLocked}
            onValueChange={(v) => setStockMode(v as "none" | "create" | "link")}
            options={[
              { value: "none", label: t("vehicle.stock.none") },
              { value: "create", label: t("vehicle.stock.create") },
              { value: "link", label: t("vehicle.stock.link") },
            ]}
          />
          {stockMode === "link" && (
            <Select
              aria-label={t("vehicle.stockWarehouse")}
              value={stockWarehouseId}
              disabled={stockLocked}
              onValueChange={setStockWarehouseId}
              placeholder={t("vehicle.stock.pick")}
              options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
            />
          )}
          <p className="text-xs text-muted-foreground">{t("vehicle.stock.hint")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="veh-notes">{t("stock.doc.notes")}</Label>
          <Textarea id="veh-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-between gap-2">
          {vehicle ? (
            <Button type="button" variant="ghost" disabled={archive.isPending} onClick={() => archive.mutate()}>
              {t(vehicle.isArchived ? "vehicle.restore" : "vehicle.archive")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={save.isPending || !plate.trim()}>{t("common.save")}</Button>
          </div>
        </div>
      </form>
    </FormDialog>
  );
}
