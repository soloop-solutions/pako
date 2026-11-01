import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BuildingResponse } from "@pako/shared";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useBuildings, vxKeys } from "@/hooks/useVerticals";
import { ErrorAlert, Field, ItemField } from "@/pages/verticals/shared";
import { useT } from "@/pages/verticals/verticals-utils";

// docs/ERP_VERTICALS_PLAN.md §2 — buildings (ndërtesat) for sale, each its own ledger project, with
// how many units are available, reserved, sold or rented.
export function Buildings() {
  const intl = useIntl();
  const t = useT();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const query = useBuildings();
  const [creating, setCreating] = useState(false);

  const columns = useMemo<ColumnDef<BuildingResponse>[]>(
    () => [
      { accessorKey: "projectCode", header: t("vx.site.projectCode") },
      { accessorKey: "name", header: t("vx.building.name") },
      { accessorKey: "address", header: t("vx.address"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "units", header: t("vx.building.units"), meta: { numeric: true } },
      { accessorKey: "available", header: t("vx.unitState.0"), meta: { numeric: true } },
      { accessorKey: "reserved", header: t("vx.unitState.1"), meta: { numeric: true } },
      { accessorKey: "sold", header: t("vx.unitState.2"), meta: { numeric: true } },
      { accessorKey: "rented", header: t("vx.unitState.4"), meta: { numeric: true } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const rows = query.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("vx.nav.buildings")}</CardTitle>
          <CardDescription>{t("vx.nav.buildings.description")}</CardDescription>
        </div>
        {canWrite("sales") && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />{t("vx.building.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataGrid
          gridId="buildings"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          onRowClick={(r) => navigate(`/real-estate/buildings/${r.id}`)}
          enableGlobalFilter
          globalFilterPlaceholder={t("vx.building.search")}
          emptyMessage={t("vx.building.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
      {creating && <BuildingDialog onClose={() => setCreating(false)} onSaved={(b) => navigate(`/real-estate/buildings/${b.id}`)} />}
    </Card>
  );
}

export function BuildingDialog({ building, onClose, onSaved }: {
  building?: BuildingResponse; onClose: () => void; onSaved: (b: BuildingResponse) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const [name, setName] = useState(building?.name ?? "");
  const [projectCode, setProjectCode] = useState(building?.projectCode ?? "");
  const [address, setAddress] = useState(building?.address ?? "");
  const [saleItemId, setSaleItemId] = useState(building?.saleItemId ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), saleItemId, projectCode: building ? undefined : projectCode.trim(), address: address.trim() || undefined };
      return building
        ? apiClient.updateBuilding(activeCompanyId as string, building.id, body)
        : apiClient.createBuilding(activeCompanyId as string, body);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: vxKeys.buildings(activeCompanyId) });
      onSaved(saved);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.building.saveError"))),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!saleItemId) return setError(t("vx.building.saleItemRequired"));
    save.mutate();
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={building ? building.name : t("vx.building.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert error={error} />
        <Field id="bld-name" label={t("vx.building.name")}>
          <Input id="bld-name" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="bld-project" label={t("vx.site.projectCode")} hint={building ? undefined : t("vx.site.projectCodeHint")}>
          <Input id="bld-project" required={!building} maxLength={20} disabled={!!building} value={projectCode} onChange={(e) => setProjectCode(e.target.value)} />
        </Field>
        <ItemField id="bld-item" label={t("vx.building.saleItem")} hint={t("vx.building.saleItemHint")} value={saleItemId} onChange={setSaleItemId} />
        <Field id="bld-address" label={t("vx.address")}>
          <Input id="bld-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
