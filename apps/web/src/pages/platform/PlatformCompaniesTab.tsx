import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PlatformCompanyResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PACKS, businessTypeLabel, sortPacks } from "@/lib/business-types";
import { Checkbox } from "@/components/ui/checkbox";

// The modules a company can have, in the order they appear in the app. Partners, items, settings,
// users and the dashboard are always on.
export const MODULES = ["sales", "purchases", "accounting", "reports", "hr", "payroll", "inventory", "pos"] as const;

const GRID_ID = "platform-companies";

/** A failure saving the packs (after the modules saved), so the message names the packs. */
class PacksSaveError extends Error {
  constructor(readonly inner: unknown) {
    super("packs");
  }
}

// Every company on PAKO, who created it, what it uses, and which modules it has.
export function PlatformCompaniesTab() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [editing, setEditing] = useState<PlatformCompanyResponse | null>(null);
  const query = useQuery({
    queryKey: ["platform", "companies", grid.page, grid.pageSize, grid.globalFilter],
    queryFn: () => apiClient.listPlatformCompanies(grid.globalFilter || undefined, undefined, grid.page, grid.pageSize),
    placeholderData: keepPreviousData,
  });
  const date = (v: string | undefined) => (v ? intl.formatDate(new Date(v), { dateStyle: "medium" }) : "—");

  const rows = query.data?.items ?? [];

  const columns = useMemo<ColumnDef<PlatformCompanyResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("companies.companyName"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className={row.original.isArchived ? "line-through" : "font-medium"}>{row.original.name}</span>
            {row.original.isArchived && <Badge variant="secondary">{t("companies.archived")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "createdByEmail", header: t("platform.col.owner"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      {
        id: "modules",
        header: t("platform.col.modules"),
        accessorFn: (c) => c.modules.length,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {MODULES.map((m) => (
              <Badge key={m} variant={row.original.modules.includes(m) ? "secondary" : "outline"} className={row.original.modules.includes(m) ? undefined : "text-muted-foreground line-through"}>
                {t(`platform.module.${m}`)}
              </Badge>
            ))}
          </span>
        ),
      },
      // Business types: the company's type, with its packs under it.
      {
        id: "businessType",
        header: t("platform.col.businessType"),
        accessorFn: (c) => businessTypeLabel(intl, c.businessType),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{businessTypeLabel(intl, row.original.businessType)}</span>
            <span className="text-xs text-muted-foreground">
              {sortPacks(row.original.features).map((p) => t(`company.pack.${p}`)).join(", ") || "—"}
            </span>
          </span>
        ),
      },
      { accessorKey: "users", header: t("platform.col.users"), meta: { numeric: true } },
      { accessorKey: "postedInvoices", header: t("platform.col.invoices"), meta: { numeric: true } },
      { accessorKey: "employees", header: t("platform.col.employees"), meta: { numeric: true } },
      { accessorKey: "lastActivity", header: t("platform.col.lastActivity"), cell: ({ getValue }) => date(getValue() as string | undefined) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-3">
      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={rows}
        rowCount={query.data?.total ?? 0}
        enableGlobalFilter
        globalFilterPlaceholder={t("platform.companies.search")}
        isLoading={query.isPending}
        getRowId={(c) => c.id}
        onRowClick={setEditing}
        emptyMessage={t("platform.companies.empty")}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
      />
      {editing && <ModulesDialog company={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ModulesDialog({ company, onClose }: { company: PlatformCompanyResponse; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const queryClient = useQueryClient();
  const [modules, setModules] = useState<string[]>(company.modules);
  // Business types: the packs on for the company (its type's preset unless changed here).
  const initialFeatures: string[] = sortPacks(company.features);
  const [features, setFeatures] = useState<string[]>(initialFeatures);
  const [error, setError] = useState<string | null>(null);

  function togglePack(pack: string, on: boolean) {
    setFeatures((current) => sortPacks(on ? [...current, pack] : current.filter((p) => p !== pack)));
  }

  function toggle(module: string, on: boolean) {
    setModules((current) => {
      let next = on ? [...new Set([...current, module])] : current.filter((m) => m !== module);
      // Payroll pays the employees kept in HR: turning HR off turns payroll off; payroll on needs HR.
      if (module === "hr" && !on) next = next.filter((m) => m !== "payroll");
      if (module === "payroll" && on && !next.includes("hr")) next = [...next, "hr"];
      return MODULES.filter((m) => next.includes(m));
    });
  }

  const modulesChanged = modules.length !== company.modules.length || modules.some((m) => !company.modules.includes(m));
  const featuresChanged = features.length !== initialFeatures.length || features.some((f) => !initialFeatures.includes(f));

  const save = useMutation({
    mutationFn: async () => {
      if (modulesChanged) await apiClient.updateCompanyModules(company.id, { modules });
      try {
        if (featuresChanged) await apiClient.updateCompanyFeatures(company.id, { features });
      } catch (err) {
        throw new PacksSaveError(err);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
    onError: (err: unknown) =>
      setError(
        err instanceof PacksSaveError
          ? getApiErrorMessage(err.inner, t("platform.packs.saveError"))
          : getApiErrorMessage(err, t("platform.modules.saveError")),
      ),
  });

  const removed = company.modules.filter((m) => !modules.includes(m));

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={company.name} description={t("platform.modules.description")} size="md" dirty={modulesChanged || featuresChanged}>
      <div className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <h3 className="text-sm font-semibold">{t("platform.modules.title")}</h3>
        <ul className="flex flex-col divide-y rounded-md border">
          {MODULES.map((m) => (
            <li key={m}>
              <label className="flex items-start gap-3 px-3 py-2.5">
                <Checkbox className="mt-1" checked={modules.includes(m)} onChange={(e) => toggle(m, e.target.checked)} />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{t(`platform.module.${m}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`platform.module.${m}.description`)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("platform.modules.alwaysOn")}</p>
        {removed.length > 0 && (
          <Alert>
            <AlertDescription>{t("platform.modules.removeWarning")}</AlertDescription>
          </Alert>
        )}
        <div>
          <h3 className="text-sm font-semibold">{t("platform.packs.title")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("company.businessType")}: {businessTypeLabel(intl, company.businessType)}. {t("platform.packs.description")}
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-x-3 rounded-md border sm:grid-cols-2" data-testid="platform-packs">
          {PACKS.map((p) => (
            <li key={p}>
              <label className="flex items-start gap-3 px-3 py-2">
                <Checkbox className="mt-1" checked={features.includes(p)} onChange={(e) => togglePack(p, e.target.checked)} />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{t(`company.pack.${p}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`company.pack.${p}.description`)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}
