import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { toast } from "sonner";
import type { DepartmentResponse, SaveDepartmentRequest } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { PartnerScope, partnerScopeLabel } from "@/lib/hr-enums";
import { DepartmentForm } from "@/pages/hr/DepartmentForm";

const GRID_ID = "departments";

export function Departments() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const { canWrite, isStaff } = useMyAccess();
  const queryClient = useQueryClient();
  // Staff can never change departments (the API forbids it, whatever their HR level).
  const readOnly = !canWrite("hr") || isStaff;

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const departmentsQueryKey = ["departments", activeCompanyId] as const;
  const departmentsQuery = useQuery({
    queryKey: departmentsQueryKey,
    queryFn: () => apiClient.listDepartments(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const costCentersQuery = useQuery({
    queryKey: ["costCenters", activeCompanyId],
    queryFn: () => apiClient.listCostCenters(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const departments = useMemo(() => departmentsQuery.data ?? [], [departmentsQuery.data]);
  const costCenters = useMemo(() => costCentersQuery.data ?? [], [costCentersQuery.data]);
  const editing = editingId ? departments.find((d) => d.id === editingId) ?? null : null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: departmentsQueryKey });
    await queryClient.invalidateQueries({ queryKey: ["employees", activeCompanyId] });
  }

  function closeForms() {
    setFormOpen(false);
    setEditingId(null);
    setMutationError(null);
  }

  const createMutation = useMutation({
    mutationFn: (request: SaveDepartmentRequest) => apiClient.createDepartment(activeCompanyId as string, request),
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "toast.departmentCreated" }));
      closeForms();
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "hr.departments.saveError" }))),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; request: SaveDepartmentRequest }) =>
      apiClient.updateDepartment(activeCompanyId as string, vars.id, vars.request),
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "toast.departmentSaved" }));
      closeForms();
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "hr.departments.saveError" }))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteDepartment(activeCompanyId as string, id),
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "toast.departmentDeleted" }));
      closeForms();
      await refresh();
    },
    // The API refuses to delete a department that still has employees or sub-departments and says
    // why — show its message as-is.
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "hr.departments.deleteError" }))),
  });

  const columns = useMemo<ColumnDef<DepartmentResponse>[]>(() => {
    const byId = new Map(departments.map((d) => [d.id, d]));
    return [
      { accessorKey: "code", header: intl.formatMessage({ id: "common.code" }) },
      { accessorKey: "name", header: intl.formatMessage({ id: "common.name" }) },
      {
        id: "parent",
        header: intl.formatMessage({ id: "hr.department.parent" }),
        accessorFn: (row) => (row.parentId ? byId.get(row.parentId)?.name ?? "" : ""),
        cell: ({ getValue }) => (getValue() as string) || "—",
      },
      {
        id: "manager",
        header: intl.formatMessage({ id: "hr.department.manager" }),
        accessorFn: (row) => row.managerName ?? "",
        cell: ({ getValue }) => (getValue() as string) || "—",
      },
      {
        accessorKey: "employeeCount",
        header: intl.formatMessage({ id: "hr.department.employeeCount" }),
        enableColumnFilter: false,
        meta: { numeric: true },
      },
      {
        id: "partnerScope",
        header: intl.formatMessage({ id: "hr.department.partnerScope" }),
        accessorFn: (row) => partnerScopeLabel(row.partnerScope, intl),
        cell: ({ row }) =>
          row.original.partnerScope === PartnerScope.Assigned ? (
            <Badge variant="info">{partnerScopeLabel(row.original.partnerScope, intl)}</Badge>
          ) : (
            <span>{partnerScopeLabel(row.original.partnerScope, intl)}</span>
          ),
      },
      {
        id: "active",
        header: intl.formatMessage({ id: "hr.employee.status" }),
        enableColumnFilter: false,
        accessorFn: (row) => intl.formatMessage({ id: row.isActive ? "common.active" : "common.inactive" }),
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge variant="success">{intl.formatMessage({ id: "common.active" })}</Badge>
          ) : (
            <Badge variant="cancelled">{intl.formatMessage({ id: "common.inactive" })}</Badge>
          ),
      },
    ];
  }, [intl, departments]);

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = departmentsQuery.isError
    ? getApiErrorMessage(departmentsQuery.error, intl.formatMessage({ id: "hr.departments.loadError" }))
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "nav.departments" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "nav.departments.description" })}</p>
        </div>
        {!readOnly && (
          <Button
            onClick={() => {
              setFormOpen((open) => !open);
              setEditingId(null);
              setMutationError(null);
            }}
          >
            {intl.formatMessage({ id: "hr.departments.new" })}
          </Button>
        )}
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {formOpen && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "hr.departments.new" })}</CardTitle>
          </CardHeader>
          <CardContent>
            <DepartmentForm
              mode="create"
              departments={departments}
              companyId={activeCompanyId}
              costCenters={costCenters}
              readOnly={false}
              submitting={createMutation.isPending}
              error={mutationError}
              onSubmit={(request) => createMutation.mutate(request)}
              onCancel={closeForms}
            />
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "hr.departments.edit" }, { name: editing.name })}</CardTitle>
          </CardHeader>
          <CardContent>
            <DepartmentForm
              key={editing.id}
              mode="edit"
              initial={editing}
              departments={departments}
              companyId={activeCompanyId}
              costCenters={costCenters}
              readOnly={readOnly}
              submitting={updateMutation.isPending}
              deleting={deleteMutation.isPending}
              error={mutationError}
              onSubmit={(request) => updateMutation.mutate({ id: editing.id, request })}
              onDelete={() => deleteMutation.mutate(editing.id)}
              onCancel={closeForms}
            />
          </CardContent>
        </Card>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={departments}
        rowCount={departments.length}
        isLoading={departmentsQuery.isPending}
        getRowId={(row) => row.id}
        getRowClassName={(row) => (row.isActive ? undefined : "text-muted-foreground")}
        onRowClick={(row) => {
          setEditingId(row.id);
          setFormOpen(false);
          setMutationError(null);
        }}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "hr.departments.searchPlaceholder" })}
        emptyMessage={intl.formatMessage({ id: "hr.departments.empty" })}
        exportFileName="departments"
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={100}
        pageSizeOptions={[50, 100, 200]}
      />
    </div>
  );
}
