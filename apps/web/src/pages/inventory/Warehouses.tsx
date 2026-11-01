import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { SaveStockSettingsRequest, WarehouseResponse } from "@pako/shared";
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
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useWarehouses } from "@/hooks/useStock";
import { useCompanyMembers } from "@/hooks/usePosServices";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { NegativeStockPolicy } from "@/lib/stock-enums";

// docs/INVENTORY_PLAN.md — where stock is kept, and the company's stock settings (cost method,
// selling below zero, default warehouse).
export function Warehouses() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const warehousesQuery = useWarehouses();
  const [editing, setEditing] = useState<WarehouseResponse | "new" | null>(null);

  const columns = useMemo<ColumnDef<WarehouseResponse>[]>(
    () => [
      { accessorKey: "code", header: t("stock.wh.code") },
      {
        accessorKey: "name",
        header: t("stock.wh.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {row.original.isDefault && <Badge>{t("stock.wh.default")}</Badge>}
            {!row.original.isActive && <Badge variant="secondary">{t("stock.wh.closed")}</Badge>}
            {row.original.isVan && <Badge variant="info">{t("dist.van")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "address", header: t("stock.wh.address"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const warehouses = warehousesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("nav.warehouses")}</CardTitle>
            <CardDescription>{t("nav.warehouses.description")}</CardDescription>
          </div>
          {canWrite("inventory") && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("stock.wh.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="warehouses"
            columns={columns}
            data={warehouses}
            rowCount={warehouses.length}
            isLoading={warehousesQuery.isPending}
            getRowId={(w) => w.id}
            getRowClassName={(w) => (w.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canWrite("inventory") ? setEditing : undefined}
            emptyMessage={t("stock.wh.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <StockSettingsCard canEdit={canApprove("inventory")} />

      {editing && (
        <WarehouseDialog
          warehouse={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["warehouses", activeCompanyId] });
            await queryClient.invalidateQueries({ queryKey: ["stockSettings", activeCompanyId] });
          }}
        />
      )}
    </div>
  );
}

function WarehouseDialog({ warehouse, onClose, onSaved }: { warehouse: WarehouseResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [code, setCode] = useState(warehouse?.code ?? "");
  const [name, setName] = useState(warehouse?.name ?? "");
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const [isActive, setIsActive] = useState(warehouse?.isActive ?? true);
  // docs/POS_PLAN.md P6: a van is a warehouse on wheels, driven by a member of the company.
  const [isVan, setIsVan] = useState(warehouse?.isVan ?? false);
  const [driverUserId, setDriverUserId] = useState(warehouse?.driverUserId ?? "");
  const members = useCompanyMembers().data ?? [];
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: code.trim(), name: name.trim(), address: address.trim() || undefined, isActive,
        isVan, driverUserId: isVan ? driverUserId || undefined : undefined,
      };
      return warehouse
        ? apiClient.updateWarehouse(activeCompanyId as string, warehouse.id, body)
        : apiClient.createWarehouse(activeCompanyId as string, body);
    },
    onSuccess: () => {
      toast.success(intl.formatMessage({ id: "toast.warehouseSaved" }));
      onSaved();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.wh.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={warehouse ? warehouse.name : t("stock.wh.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="wh-code">{t("stock.wh.code")}</Label>
            <Input id="wh-code" required maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="wh-name">{t("stock.wh.name")}</Label>
            <Input id="wh-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="wh-address">{t("stock.wh.address")}</Label>
          <Input id="wh-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isVan} onChange={(e) => setIsVan(e.target.checked)} />
          {t("dist.wh.isVan")}
        </label>
        {isVan && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="wh-driver">{t("dist.wh.driver")}</Label>
            <SearchableSelect
              id="wh-driver"
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
            <p className="text-xs text-muted-foreground">{t("dist.wh.driverHint")}</p>
          </div>
        )}
        {warehouse && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("stock.wh.active")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function StockSettingsCard({ canEdit }: { canEdit: boolean }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const warehouses = (useWarehouses().data ?? []).filter((w) => w.isActive);
  const query = useQuery({
    queryKey: ["stockSettings", activeCompanyId],
    queryFn: () => apiClient.getStockSettings(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: SaveStockSettingsRequest) => apiClient.saveStockSettings(activeCompanyId as string, body),
    onSuccess: async (saved) => {
      setError(null);
      toast.success(intl.formatMessage({ id: "toast.stockSettingsSaved" }));
      queryClient.setQueryData(["stockSettings", activeCompanyId], saved);
      await queryClient.invalidateQueries({ queryKey: ["warehouses", activeCompanyId] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.settings.saveError"))),
  });
  const settings = query.data;
  if (!settings) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stock.settings.title")}</CardTitle>
        <CardDescription>{t("stock.settings.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label>{t("stock.settings.costMethod")}</Label>
            <p className="text-sm">{t("stock.settings.costMethod.average")}</p>
            <p className="text-xs text-muted-foreground">
              {t(settings.costMethodLocked ? "stock.settings.costMethod.locked" : "stock.settings.costMethod.hint")}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ss-negative">{t("stock.settings.negative")}</Label>
            <Select
              id="ss-negative"
              value={String(settings.negativeStock)}
              disabled={!canEdit || save.isPending}
              onValueChange={(v) => save.mutate({ negativeStock: Number(v), defaultWarehouseId: settings.defaultWarehouseId })}
              options={[
                { value: String(NegativeStockPolicy.Block), label: t("stock.settings.negative.block") },
                { value: String(NegativeStockPolicy.Warn), label: t("stock.settings.negative.warn") },
              ]}
            />
            <p className="text-xs text-muted-foreground">{t("stock.settings.negative.hint")}</p>
          </div>
          {warehouses.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="ss-default">{t("stock.settings.defaultWarehouse")}</Label>
              <Select
                id="ss-default"
                value={settings.defaultWarehouseId ?? ""}
                disabled={!canEdit || save.isPending}
                onValueChange={(v) => save.mutate({ negativeStock: settings.negativeStock, defaultWarehouseId: v })}
                options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
