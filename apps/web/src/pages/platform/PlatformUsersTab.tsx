import { useMemo, useState } from "react";
import { useUrlParam } from "@/pages/platform/useUrlParam";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PlatformUserResponse } from "@pako/shared";
import { Search } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { UserAccessForm } from "@/pages/platform/UserAccessForm";

// Every PAKO account: who they are, how many companies they created against their limit, how many
// companies they can open, and whether the account is active.
export function PlatformUsersTab() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const [search, setSearch] = useUrlParam("q");
  const [editing, setEditing] = useState<PlatformUserResponse | null>(null);
  const query = useQuery({ queryKey: ["platform", "users"], queryFn: () => apiClient.listPlatformUsers(undefined) });
  const date = (v: string | undefined) => (v ? intl.formatDate(new Date(v), { dateStyle: "medium" }) : "—");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data ?? []).filter((u) => !q || u.email.toLowerCase().includes(q) || (u.fullName ?? "").toLowerCase().includes(q));
  }, [query.data, search]);

  const columns = useMemo<ColumnDef<PlatformUserResponse>[]>(
    () => [
      {
        accessorKey: "email",
        header: t("platform.col.user"),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium">{row.original.fullName ?? row.original.email}</span>
            {row.original.fullName && <span className="text-xs text-muted-foreground">{row.original.email}</span>}
          </span>
        ),
      },
      {
        id: "role",
        header: t("platform.col.status"),
        accessorFn: (u) => (u.isDisabled ? "0" : u.isPlatformAdmin ? "2" : "1"),
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.isPlatformAdmin && <Badge>{t("platform.admin")}</Badge>}
            {row.original.isDisabled ? <Badge variant="destructive">{t("platform.disabled")}</Badge> : <Badge variant="secondary">{t("platform.active")}</Badge>}
          </span>
        ),
      },
      {
        id: "companies",
        header: t("platform.col.companiesCreated"),
        accessorFn: (u) => u.companiesCreated,
        meta: { numeric: true },
        cell: ({ row }) => {
          const { companiesCreated, companyLimit, isPlatformAdmin } = row.original;
          const used = intl.formatNumber(companiesCreated);
          return companyLimit == null || isPlatformAdmin ? t("platform.ofUnlimited", { used }) : t("platform.ofLimit", { used, limit: intl.formatNumber(companyLimit) });
        },
      },
      { accessorKey: "companyAccessCount", header: t("platform.col.access"), meta: { numeric: true } },
      { accessorKey: "createdAt", header: t("platform.col.created"), cell: ({ getValue }) => date(getValue() as string) },
      { accessorKey: "lastLoginAt", header: t("platform.col.lastLogin"), cell: ({ getValue }) => date(getValue() as string | undefined) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("platform.users.search")} aria-label={t("platform.users.search")} />
      </div>
      <DataGrid
        gridId="platform-users"
        columns={columns}
        data={rows}
        rowCount={rows.length}
        isLoading={query.isPending}
        getRowId={(u) => u.id}
        getRowClassName={(u) => (u.isDisabled ? "text-muted-foreground" : undefined)}
        onRowClick={setEditing}
        emptyMessage={t("platform.users.empty")}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
      />
      {editing && (
        <FormDialog open onOpenChange={(open) => !open && setEditing(null)} title={editing.fullName ?? editing.email} description={editing.email} size="sm">
          <UserAccessForm
            user={{
              userId: editing.id,
              companyLimit: editing.companyLimit,
              isDisabled: editing.isDisabled,
              isPlatformAdmin: editing.isPlatformAdmin,
              companiesCreated: editing.companiesCreated,
            }}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </FormDialog>
      )}
    </div>
  );
}
