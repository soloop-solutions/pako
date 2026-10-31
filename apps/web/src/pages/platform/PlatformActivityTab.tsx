import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PlatformAuditResponse } from "@pako/shared";
import { useIntl, type IntlShape } from "react-intl";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";

const GRID_ID = "platform-activity";

type Json = Record<string, unknown>;

// What changed, in words: "Company limit: 1 → 3 · Disabled: no → yes", "Modules: + HR, − Payroll".
function describe(intl: IntlShape, entry: PlatformAuditResponse): string {
  const t = (id: string) => intl.formatMessage({ id });
  let details: Json = {};
  try {
    details = entry.details ? (JSON.parse(entry.details) as Json) : {};
  } catch {
    return "";
  }
  const yesNo = (v: unknown) => t(v ? "platform.activity.yes" : "platform.activity.no");
  const limit = (v: unknown) => (v === null || v === undefined ? t("platform.user.unlimited") : String(v));

  if (entry.action === "UpdateUser") {
    const before = (details.before ?? {}) as Json;
    const after = (details.after ?? {}) as Json;
    const parts: string[] = [];
    if (before.companyLimit !== after.companyLimit) parts.push(`${t("platform.activity.limit")}: ${limit(before.companyLimit)} → ${limit(after.companyLimit)}`);
    if (before.isDisabled !== after.isDisabled) parts.push(`${t("platform.disabled")}: ${yesNo(before.isDisabled)} → ${yesNo(after.isDisabled)}`);
    if (before.isPlatformAdmin !== after.isPlatformAdmin) parts.push(`${t("platform.admin")}: ${yesNo(before.isPlatformAdmin)} → ${yesNo(after.isPlatformAdmin)}`);
    return parts.join(" · ") || t("platform.activity.noChange");
  }
  if (entry.action === "UpdateModules") {
    const before = new Set((details.before as string[] | undefined) ?? []);
    const after = new Set((details.after as string[] | undefined) ?? []);
    const name = (m: string) => t(`platform.module.${m}`);
    const added = [...after].filter((m) => !before.has(m)).map((m) => `+ ${name(m)}`);
    const removed = [...before].filter((m) => !after.has(m)).map((m) => `− ${name(m)}`);
    return [...added, ...removed].join(", ") || t("platform.activity.noChange");
  }
  if (entry.action === "ApproveRequest") {
    return `${t("platform.activity.limit")}: ${limit(details.companyLimit)}${details.note ? ` · ${String(details.note)}` : ""}`;
  }
  return details.note ? String(details.note) : "";
}

// Every change made in this panel, newest first: who did what to whom, and what changed.
export function PlatformActivityTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const grid = useDataGridUrlState(GRID_ID, 50);
  const query = useQuery({
    queryKey: ["platform", "audit", grid.page, grid.pageSize],
    queryFn: () => apiClient.listPlatformAudit(grid.page, grid.pageSize),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<PlatformAuditResponse>[]>(
    () => [
      {
        accessorKey: "occurredAt",
        header: t("platform.activity.when"),
        cell: ({ getValue }) => intl.formatDate(new Date(getValue() as string), { dateStyle: "medium", timeStyle: "short" }),
      },
      { accessorKey: "actorEmail", header: t("platform.activity.who"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "action", header: t("platform.activity.what"), cell: ({ getValue }) => t(`platform.activity.action.${getValue() as string}`) },
      { accessorKey: "targetLabel", header: t("platform.activity.target") },
      { id: "details", header: t("platform.activity.details"), cell: ({ row }) => <span className="text-muted-foreground">{describe(intl, row.original)}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <DataGrid
      gridId={GRID_ID}
      columns={columns}
      data={query.data?.items ?? []}
      rowCount={query.data?.total ?? 0}
      isLoading={query.isPending}
      getRowId={(e) => e.id}
      emptyMessage={t("platform.activity.empty")}
    />
  );
}
