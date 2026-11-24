import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/list/PageHeader";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { AuditEntryResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { serverSideColumns, usePagedGrid } from "@/components/data-grid/usePagedGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useIsCompanyAdmin } from "@/hooks/useIsCompanyAdmin";
import { downloadFileResponse } from "@/lib/download";
import { AuditDetailDialog } from "@/pages/audit/AuditDetailDialog";
import { AuditVerifyPanel } from "@/pages/audit/AuditVerifyPanel";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  auditActionLabel,
  auditEntityPath,
  auditEntityTypeLabel,
  formatAuditDateTime,
} from "@/pages/audit/auditFormat";

const GRID_ID = "audit-trail";
const ALL = "";

function userLabel(entry: AuditEntryResponse, system: string): string {
  if (entry.userName && entry.userEmail) return `${entry.userName} (${entry.userEmail})`;
  return entry.userName ?? entry.userEmail ?? system;
}

export function AuditTrail() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const { isAdmin, isLoading: adminLoading } = useIsCompanyAdmin(activeCompanyId);
  const [detailId, setDetailId] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ["members", "company", activeCompanyId],
    queryFn: () => apiClient.membersAll(activeCompanyId as string),
    enabled: !!activeCompanyId && isAdmin,
  });

  const paged = usePagedGrid<AuditEntryResponse>({
    gridId: GRID_ID,
    enabled: !!activeCompanyId && isAdmin,
    queryKey: ["audit", activeCompanyId, "paged"],
    fetchPage: async ({ page, pageSize, search, filters }) => {
      const result = await apiClient.auditPaged(
        activeCompanyId as string,
        page,
        pageSize,
        filters.entityType || undefined,
        undefined,
        filters.user || undefined,
        filters.action || undefined,
        filters.from || undefined,
        filters.to || undefined,
        search,
      );
      return { items: result.items, total: result.total };
    },
  });
  const { urlState } = paged;
  const filters = urlState.columnFilters;
  const hasFilters = Object.keys(filters).length > 0 || urlState.globalFilter !== "";

  const exportMutation = useMutation({
    mutationFn: async () =>
      downloadFileResponse(
        await apiClient.auditExport(
          activeCompanyId as string,
          filters.entityType || undefined,
          undefined,
          filters.user || undefined,
          filters.action || undefined,
          filters.from || undefined,
          filters.to || undefined,
          urlState.globalFilter.trim() || undefined,
        ),
        "audit-trail.xlsx",
      ),
  });

  const columns = useMemo<ColumnDef<AuditEntryResponse>[]>(() => {
    const system = intl.formatMessage({ id: "audit.system" });
    return serverSideColumns<AuditEntryResponse>(
      [
        {
          id: "time",
          header: intl.formatMessage({ id: "audit.col.time" }),
          accessorFn: (row) => formatAuditDateTime(row.occurredAtUtc),
        },
        {
          id: "user",
          header: intl.formatMessage({ id: "audit.col.user" }),
          accessorFn: (row) => userLabel(row, system),
        },
        {
          id: "action",
          header: intl.formatMessage({ id: "audit.col.action" }),
          accessorFn: (row) => auditActionLabel(intl, row.action),
          cell: ({ row }) => <Badge variant="outline">{auditActionLabel(intl, row.original.action)}</Badge>,
        },
        {
          id: "entityType",
          header: intl.formatMessage({ id: "audit.col.entityType" }),
          accessorFn: (row) => auditEntityTypeLabel(intl, row.entityType),
        },
        {
          id: "entity",
          header: intl.formatMessage({ id: "audit.col.entity" }),
          accessorFn: (row) => row.entityId,
          cell: ({ row }) => {
            const path = auditEntityPath(row.original.entityType, row.original.entityId);
            return path ? (
              <Link className="text-primary underline-offset-2 hover:underline" to={path}>
                {intl.formatMessage({ id: "audit.openRecord" })}
              </Link>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">{row.original.entityId.slice(0, 8)}</span>
            );
          },
        },
        {
          id: "ip",
          header: intl.formatMessage({ id: "audit.col.ip" }),
          accessorFn: (row) => row.ipAddress ?? "—",
        },
        {
          id: "sequence",
          header: intl.formatMessage({ id: "audit.col.sequence" }),
          meta: { numeric: true },
          accessorFn: (row) => row.sequenceNumber ?? "—",
        },
        {
          id: "details",
          header: "",
          enableHiding: false,
          cell: ({ row }) => (
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setDetailId(row.original.id)}>
              {intl.formatMessage({ id: "audit.viewDetails" })}
            </Button>
          ),
        },
      ],
      [],
    );
  }, [intl]);

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }
  if (adminLoading) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>;
  }
  if (!isAdmin) {
    return <EmptyState icon={ScrollText} title={intl.formatMessage({ id: "audit.title" })} description={intl.formatMessage({ id: "audit.adminOnly" })} />;
  }

  const userOptions = [
    { value: ALL, label: intl.formatMessage({ id: "audit.filter.allUsers" }) },
    ...(membersQuery.data ?? []).map((m) => ({ value: m.userId, label: m.email })),
  ];
  const actionOptions = [
    { value: ALL, label: intl.formatMessage({ id: "audit.filter.allActions" }) },
    ...AUDIT_ACTIONS.map((a) => ({ value: a, label: auditActionLabel(intl, a) })),
  ];
  const entityOptions = [
    { value: ALL, label: intl.formatMessage({ id: "audit.filter.allEntityTypes" }) },
    ...AUDIT_ENTITY_TYPES.map((t) => ({ value: t, label: auditEntityTypeLabel(intl, t) })),
  ];

  const loadError = paged.query.isError
    ? getApiErrorMessage(paged.query.error, intl.formatMessage({ id: "audit.loadError" }))
    : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={intl.formatMessage({ id: "audit.title" })}
        description={intl.formatMessage({ id: "audit.description" })}
        actions={
          <Button variant="outline" size="sm" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            <Download className="size-4" />
            {intl.formatMessage({ id: exportMutation.isPending ? "audit.exporting" : "audit.export" })}
          </Button>
        }
      />

      <AuditVerifyPanel companyId={activeCompanyId} onOpenEntry={setDetailId} />

      {exportMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(exportMutation.error, intl.formatMessage({ id: "audit.exportError" }))}</AlertDescription>
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <div role="group" aria-label={intl.formatMessage({ id: "audit.col.details" })} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FilterField id="audit-filter-user" label={intl.formatMessage({ id: "audit.filter.user" })}>
          <Select id="audit-filter-user" aria-label={intl.formatMessage({ id: "audit.filter.user" })} value={filters.user ?? ALL} onValueChange={(v) => urlState.setColumnFilter("user", v)} options={userOptions} />
        </FilterField>
        <FilterField id="audit-filter-action" label={intl.formatMessage({ id: "audit.filter.action" })}>
          <Select id="audit-filter-action" aria-label={intl.formatMessage({ id: "audit.filter.action" })} value={filters.action ?? ALL} onValueChange={(v) => urlState.setColumnFilter("action", v)} options={actionOptions} />
        </FilterField>
        <FilterField id="audit-filter-entity" label={intl.formatMessage({ id: "audit.filter.entityType" })}>
          <Select id="audit-filter-entity" aria-label={intl.formatMessage({ id: "audit.filter.entityType" })} value={filters.entityType ?? ALL} onValueChange={(v) => urlState.setColumnFilter("entityType", v)} options={entityOptions} />
        </FilterField>
        <FilterField id="audit-filter-from" label={intl.formatMessage({ id: "audit.filter.from" })}>
          <DatePicker id="audit-filter-from" clearable value={filters.from ?? ""} max={filters.to || undefined} onValueChange={(v) => urlState.setColumnFilter("from", v)} />
        </FilterField>
        <FilterField id="audit-filter-to" label={intl.formatMessage({ id: "audit.filter.to" })}>
          <DatePicker id="audit-filter-to" clearable value={filters.to ?? ""} min={filters.from || undefined} onValueChange={(v) => urlState.setColumnFilter("to", v)} />
        </FilterField>
      </div>
      {hasFilters && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              ["user", "action", "entityType", "from", "to"].forEach((id) => urlState.setColumnFilter(id, ""));
              urlState.setGlobalFilter("");
            }}
          >
            {intl.formatMessage({ id: "audit.filter.clear" })}
          </Button>
        </div>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={paged.items}
        rowCount={paged.total}
        isLoading={paged.query.isPending}
        getRowId={(row) => row.id}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "audit.search" })}
        emptyMessage={intl.formatMessage({ id: "audit.empty" })}
        pageSizeOptions={[50, 100, 200]}
      />

      <AuditDetailDialog companyId={activeCompanyId} entryId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function FilterField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
