import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { EmployeeDetailResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { ProfileChangesPanel } from "@/pages/hr/ProfileChangesPanel";
import { employeeWarningLabel } from "@/lib/hr-enums";

const GRID_ID = "employees";
const DEPARTMENT_PARAM = `${GRID_ID}.dept`;
const INACTIVE_PARAM = `${GRID_ID}.inactive`;
// Columns the API can sort by (EmployeesController: sort=name|hireDate|salary, "-" = descending).
const SORTABLE = new Set(["name", "hireDate", "salary"]);

export function Employees() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const urlState = useDataGridUrlState(GRID_ID, 50);
  const [searchParams, setSearchParams] = useSearchParams();

  const departmentId = searchParams.get(DEPARTMENT_PARAM) ?? "";
  const includeInactive = searchParams.get(INACTIVE_PARAM) === "1";
  const sort = urlState.sort && SORTABLE.has(urlState.sort.id) ? `${urlState.sort.desc ? "-" : ""}${urlState.sort.id}` : undefined;

  function setParam(key: string, value: string | null) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set(key, value);
        else params.delete(key);
        params.delete(`${GRID_ID}.page`);
        return params;
      },
      { replace: true },
    );
  }

  const employeesQuery = useQuery({
    queryKey: ["employees", activeCompanyId, urlState.page, urlState.pageSize, urlState.globalFilter, sort, departmentId, includeInactive],
    queryFn: () =>
      apiClient.listEmployees(
        activeCompanyId as string,
        urlState.page,
        urlState.pageSize,
        urlState.globalFilter || undefined,
        sort,
        departmentId || undefined,
        includeInactive,
        false,
      ),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const departmentsQuery = useQuery({
    queryKey: ["departments", activeCompanyId],
    queryFn: () => apiClient.listDepartments(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const departments = useMemo(() => departmentsQuery.data ?? [], [departmentsQuery.data]);

  const columns = useMemo<ColumnDef<EmployeeDetailResponse>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: intl.formatMessage({ id: "hr.employee.name" }),
        enableColumnFilter: false,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "personalNumber",
        accessorKey: "personalNumber",
        header: intl.formatMessage({ id: "hr.employee.personalNumber" }),
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ getValue }) => <span className="tabular-nums">{(getValue() as string | undefined) || "—"}</span>,
      },
      {
        id: "department",
        accessorFn: (row) => row.departmentName ?? "",
        header: intl.formatMessage({ id: "hr.employee.department" }),
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ getValue }) => (getValue() as string) || "—",
      },
      {
        id: "jobTitle",
        accessorKey: "jobTitle",
        header: intl.formatMessage({ id: "hr.employee.jobTitle" }),
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ getValue }) => (getValue() as string | undefined) || "—",
      },
      {
        id: "hireDate",
        accessorKey: "hireDate",
        header: intl.formatMessage({ id: "hr.employee.hireDate" }),
        enableColumnFilter: false,
        cell: ({ getValue }) => <span className="tabular-nums">{(getValue() as string | undefined) || "—"}</span>,
      },
      {
        id: "salary",
        accessorKey: "currentSalary",
        header: intl.formatMessage({ id: "hr.employee.currentSalary" }),
        enableColumnFilter: false,
        meta: { numeric: true },
        cell: ({ getValue }) => `${(getValue() as number).toFixed(2)} €`,
      },
      {
        id: "status",
        header: intl.formatMessage({ id: "hr.employee.status" }),
        enableSorting: false,
        enableColumnFilter: false,
        accessorFn: (row) => intl.formatMessage({ id: row.isActive ? "common.active" : "common.inactive" }),
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge variant="success">{intl.formatMessage({ id: "common.active" })}</Badge>
          ) : (
            <Badge variant="cancelled">{intl.formatMessage({ id: "common.inactive" })}</Badge>
          ),
      },
      {
        id: "warnings",
        header: intl.formatMessage({ id: "hr.employee.warnings" }),
        enableSorting: false,
        enableColumnFilter: false,
        accessorFn: (row) => row.warnings.map((w) => employeeWarningLabel(w, intl)).join(", "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.warnings.map((code) => (
              <Badge key={code} variant="warning">
                {employeeWarningLabel(code, intl)}
              </Badge>
            ))}
          </div>
        ),
      },
    ],
    [intl],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = employeesQuery.isError
    ? getApiErrorMessage(employeesQuery.error, intl.formatMessage({ id: "hr.employees.loadError" }))
    : null;
  const employees = employeesQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "nav.employees" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "nav.employees.description" })}</p>
        </div>
        {canWrite("hr") && (
          <Button onClick={() => navigate("/employees/new")}>{intl.formatMessage({ id: "hr.employees.new" })}</Button>
        )}
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <ProfileChangesPanel companyId={activeCompanyId} canDecide={canApprove("hr")} />

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="employees-department" className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: "hr.employee.department" })}
          </label>
          <Select
            id="employees-department"
            className="w-56"
            value={departmentId}
            onValueChange={(v) => setParam(DEPARTMENT_PARAM, v || null)}
            placeholder={intl.formatMessage({ id: "hr.employees.allDepartments" })}
            options={departments.map((d) => ({
              value: d.id,
              label: `${d.code} — ${d.name}`,
            }))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setParam(INACTIVE_PARAM, e.target.checked ? "1" : null)} />
          {intl.formatMessage({ id: "hr.employees.includeInactive" })}
        </label>
      </div>

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={employees}
        rowCount={employeesQuery.data?.total ?? 0}
        isLoading={employeesQuery.isPending}
        getRowId={(row) => row.id}
        getRowClassName={(row) => (row.isActive ? undefined : "text-muted-foreground")}
        onRowClick={(row) => navigate(`/employees/${row.id}`)}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "hr.employees.searchPlaceholder" })}
        emptyMessage={intl.formatMessage({ id: "hr.employees.empty" })}
        exportFileName="employees"
        defaultPageSize={50}
        pageSizeOptions={[25, 50, 100, 200]}
      />
    </div>
  );
}
