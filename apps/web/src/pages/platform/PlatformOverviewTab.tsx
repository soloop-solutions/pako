import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { AccountantUsageResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList } from "@/pages/dashboard/charts";
import { AccountantDialog } from "@/pages/platform/AccountantDialog";

// Usage at a glance: totals, the busiest accountants, and one row per accountant with their
// companies against their limit and what those companies have done.
export function PlatformOverviewTab({ onOpenRequests }: { onOpenRequests: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const [open, setOpen] = useState<AccountantUsageResponse | null>(null);
  const query = useQuery({ queryKey: ["platform", "overview"], queryFn: () => apiClient.getPlatformOverview() });
  const data = query.data;
  const n = (v: number) => intl.formatNumber(v);
  const date = (v: string | undefined) => (v ? intl.formatDate(new Date(v), { dateStyle: "medium" }) : "—");

  const columns = useMemo<ColumnDef<AccountantUsageResponse>[]>(
    () => [
      {
        accessorKey: "email",
        header: t("platform.col.accountant"),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium">{row.original.fullName ?? row.original.email}</span>
            {row.original.fullName && <span className="text-xs text-muted-foreground">{row.original.email}</span>}
          </span>
        ),
      },
      {
        id: "companies",
        header: t("platform.col.companies"),
        accessorFn: (r) => r.companiesCreated,
        meta: { numeric: true },
        cell: ({ row }) => {
          const { companiesCreated, companyLimit } = row.original;
          const full = companyLimit != null && companiesCreated >= companyLimit;
          return (
            <span className={full ? "font-semibold text-destructive" : undefined}>
              {companyLimit == null ? t("platform.ofUnlimited", { used: n(companiesCreated) }) : t("platform.ofLimit", { used: n(companiesCreated), limit: n(companyLimit) })}
            </span>
          );
        },
      },
      { accessorKey: "teamMembers", header: t("platform.col.team"), meta: { numeric: true } },
      { accessorKey: "postedInvoices", header: t("platform.col.invoices"), meta: { numeric: true } },
      { accessorKey: "invoicesLast30Days", header: t("platform.col.invoices30"), meta: { numeric: true } },
      { accessorKey: "postedBills", header: t("platform.col.bills"), meta: { numeric: true } },
      { accessorKey: "employees", header: t("platform.col.employees"), meta: { numeric: true } },
      { accessorKey: "payrollRuns", header: t("platform.col.payrollRuns"), meta: { numeric: true } },
      { accessorKey: "lastLoginAt", header: t("platform.col.lastLogin"), cell: ({ getValue }) => date(getValue() as string | undefined) },
      { accessorKey: "lastActivity", header: t("platform.col.lastActivity"), cell: ({ getValue }) => date(getValue() as string | undefined) },
      {
        accessorKey: "isDisabled",
        header: t("platform.col.status"),
        cell: ({ getValue }) => (getValue() ? <Badge variant="destructive">{t("platform.disabled")}</Badge> : <Badge variant="secondary">{t("platform.active")}</Badge>),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{getApiErrorMessage(query.error, t("platform.loadError"))}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">{t("platform.loading")}</p>;

  const tiles: [string, number][] = [
    ["platform.stat.accountants", data.accountantCount],
    ["platform.stat.companies", data.companies],
    ["platform.stat.users", data.users],
    ["platform.stat.active30", data.activeUsersLast30Days],
    ["platform.stat.invoices30", data.invoicesLast30Days],
  ];
  const busiest = [...data.accountants].sort((a, b) => b.invoicesLast30Days - a.invoicesLast30Days).slice(0, 8)
    .filter((a) => a.invoicesLast30Days > 0)
    .map((a) => ({ name: a.fullName ?? a.email, current: a.invoicesLast30Days }));
  const companyUse = [...data.accountants].sort((a, b) => b.companiesCreated - a.companiesCreated).slice(0, 8)
    .filter((a) => a.companiesCreated > 0)
    .map((a) => ({ name: a.fullName ?? a.email, current: a.companiesCreated }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([key, value]) => (
          <Card key={key} className="gap-1 py-4">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">{t(key)}</p>
              <p className="text-2xl font-semibold">{n(value)}</p>
            </CardContent>
          </Card>
        ))}
        <Card className={data.pendingRequests > 0 ? "gap-1 border-primary/50 py-4" : "gap-1 py-4"}>
          <CardContent className="flex flex-col items-start gap-1 px-4">
            <p className="text-xs text-muted-foreground">{t("platform.stat.pending")}</p>
            <p className="text-2xl font-semibold">{n(data.pendingRequests)}</p>
            {data.pendingRequests > 0 && (
              <Button size="xs" variant="outline" onClick={onOpenRequests}>
                {t("platform.review")}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("platform.chart.busiest")}</CardTitle>
            <CardDescription className="text-xs">{t("platform.chart.busiest.description")}</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            {busiest.length ? (
              <BarList rows={busiest} currentName={t("platform.col.invoices30")} showPrevious={false} format={n} />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("platform.noActivity")}</p>
            )}
          </CardContent>
        </Card>
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("platform.chart.companies")}</CardTitle>
            <CardDescription className="text-xs">{t("platform.chart.companies.description")}</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            {companyUse.length ? (
              <BarList rows={companyUse} currentName={t("platform.col.companies")} showPrevious={false} format={n} />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("platform.noActivity")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("platform.usage.title")}</CardTitle>
          <CardDescription className="text-xs">{t("platform.usage.description")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <DataGrid
            gridId="platform-accountants"
            columns={columns}
            data={data.accountants}
            rowCount={data.accountants.length}
            getRowId={(r) => r.userId}
            onRowClick={setOpen}
            emptyMessage={t("platform.noAccountants")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      {open && <AccountantDialog accountant={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
