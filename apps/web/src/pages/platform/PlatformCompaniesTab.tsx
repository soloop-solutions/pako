import { useMemo, useState } from "react";
import { useUrlParam } from "@/pages/platform/useUrlParam";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PlatformCompanyResponse } from "@pako/shared";
import { Search } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The modules a company can have, in the order they appear in the app. Partners, items, settings,
// users and the dashboard are always on.
export const MODULES = ["sales", "purchases", "accounting", "reports", "hr", "payroll"] as const;

// Every company on PAKO, who created it, what it uses, and which modules it has.
export function PlatformCompaniesTab() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const [search, setSearch] = useUrlParam("q");
  const [editing, setEditing] = useState<PlatformCompanyResponse | null>(null);
  const query = useQuery({ queryKey: ["platform", "companies"], queryFn: () => apiClient.listPlatformCompanies(undefined, undefined) });
  const date = (v: string | undefined) => (v ? intl.formatDate(new Date(v), { dateStyle: "medium" }) : "—");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || (c.businessNumber ?? "").includes(q) || (c.createdByEmail ?? "").toLowerCase().includes(q),
    );
  }, [query.data, search]);

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
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("platform.companies.search")} aria-label={t("platform.companies.search")} />
      </div>
      <DataGrid
        gridId="platform-companies"
        columns={columns}
        data={rows}
        rowCount={rows.length}
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
  const [error, setError] = useState<string | null>(null);

  function toggle(module: string, on: boolean) {
    setModules((current) => {
      let next = on ? [...new Set([...current, module])] : current.filter((m) => m !== module);
      // Payroll pays the employees kept in HR: turning HR off turns payroll off; payroll on needs HR.
      if (module === "hr" && !on) next = next.filter((m) => m !== "payroll");
      if (module === "payroll" && on && !next.includes("hr")) next = [...next, "hr"];
      return MODULES.filter((m) => next.includes(m));
    });
  }

  const save = useMutation({
    mutationFn: () => apiClient.updateCompanyModules(company.id, { modules }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("platform.modules.saveError"))),
  });

  const removed = company.modules.filter((m) => !modules.includes(m));

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={company.name} description={t("platform.modules.description")} size="md" dirty={removed.length > 0 || modules.length !== company.modules.length}>
      <div className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ul className="flex flex-col divide-y rounded-md border">
          {MODULES.map((m) => (
            <li key={m}>
              <label className="flex items-start gap-3 px-3 py-2.5">
                <input type="checkbox" className="mt-1" checked={modules.includes(m)} onChange={(e) => toggle(m, e.target.checked)} />
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
