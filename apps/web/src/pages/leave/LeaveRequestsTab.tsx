import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { LeaveRequestResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LeaveStateBadge } from "@/pages/leave/LeaveStateBadge";
import {
  LEAVE_STATES,
  formatDate,
  formatDateTime,
  isLeaveState,
  leaveRequestActions,
  useLeaveEmployees,
  useLeaveTypes,
} from "@/pages/leave/leaveShared";

const GRID_ID = "leaveRequests";
const DEFAULT_PAGE_SIZE = 50;
const ALL_STATES = "all";

type RowAction = "approve" | "reject" | "cancel";

export function LeaveRequestsTab({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const grid = useDataGridUrlState(GRID_ID, DEFAULT_PAGE_SIZE);

  // Default filter is Pending — the approver's inbox. "all" in the URL lifts the filter.
  const stateParam = searchParams.get("state");
  const stateFilter = stateParam === ALL_STATES ? ALL_STATES : isLeaveState(stateParam) ? stateParam : "Pending";
  const employeeFilter = searchParams.get("employee") ?? "";

  const [formOpen, setFormOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const employeesQuery = useLeaveEmployees(companyId);
  const typesQuery = useLeaveTypes(companyId);

  const requestsQuery = useQuery({
    queryKey: ["leave", "requests", companyId, grid.page, grid.pageSize, stateFilter, employeeFilter],
    queryFn: () =>
      apiClient.listLeaveRequests(
        companyId,
        grid.page,
        grid.pageSize,
        stateFilter === ALL_STATES ? undefined : stateFilter,
        employeeFilter || undefined,
        undefined,
        undefined,
      ),
    placeholderData: keepPreviousData,
  });

  function setFilter(key: "state" | "employee", value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (!value) params.delete(key);
        else params.set(key, value);
        params.delete(`${GRID_ID}.page`);
        return params;
      },
      { replace: true },
    );
  }

  async function refreshAll() {
    // A decision moves days between pending/taken, so balances and the calendar go stale too.
    await queryClient.invalidateQueries({ queryKey: ["leave"] });
  }

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: RowAction }) => {
      if (action === "approve") return apiClient.approveLeaveRequest(companyId, id);
      if (action === "reject") return apiClient.rejectLeaveRequest(companyId, id);
      return apiClient.cancelLeaveRequest(companyId, id);
    },
    onSuccess: async () => {
      setActionError(null);
      setConfirmCancelId(null);
      await refreshAll();
    },
    onError: (err: unknown, vars) =>
      setActionError(getApiErrorMessage(err, intl.formatMessage({ id: `leave.requests.${vars.action}Error` }))),
  });

  // Server-paged: the API filters by state/employee and orders by start date, so the grid's own
  // sort/filter/group controls (which would only reorder the current page) are switched off.
  const columns = useMemo<ColumnDef<LeaveRequestResponse>[]>(
    () => ([
      { accessorKey: "employeeName", header: intl.formatMessage({ id: "leave.field.employee" }) },
      { accessorKey: "leaveTypeName", header: intl.formatMessage({ id: "leave.field.type" }) },
      {
        accessorKey: "startDate",
        header: intl.formatMessage({ id: "leave.field.startDate" }),
        cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue() as string)}</span>,
      },
      {
        accessorKey: "endDate",
        header: intl.formatMessage({ id: "leave.field.endDate" }),
        cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue() as string)}</span>,
      },
      {
        accessorKey: "days",
        header: intl.formatMessage({ id: "leave.field.workingDays" }),
        meta: { numeric: true },
      },
      {
        accessorKey: "reason",
        header: intl.formatMessage({ id: "leave.field.reason" }),
        enableSorting: false,
        cell: ({ getValue }) => {
          const reason = getValue() as string | undefined;
          return reason ? (
            <span className="block max-w-[280px] truncate" title={reason}>
              {reason}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "leave.field.state" }),
        cell: ({ getValue }) => <LeaveStateBadge state={getValue() as string} />,
      },
      {
        accessorKey: "decidedAt",
        header: intl.formatMessage({ id: "leave.field.decidedAt" }),
        cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{formatDateTime(getValue() as string | undefined)}</span>,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => {
          const request = row.original;
          const allowed = leaveRequestActions(request.state);
          const busy = actionMutation.isPending;
          return (
            <div className="flex justify-end gap-1">
              {allowed.approve && (
                <Button size="sm" variant="outline" className="h-6 text-xs" disabled={busy} onClick={() => actionMutation.mutate({ id: request.id, action: "approve" })}>
                  {intl.formatMessage({ id: "leave.action.approve" })}
                </Button>
              )}
              {allowed.reject && (
                <Button size="sm" variant="outline" className="h-6 text-xs" disabled={busy} onClick={() => actionMutation.mutate({ id: request.id, action: "reject" })}>
                  {intl.formatMessage({ id: "leave.action.reject" })}
                </Button>
              )}
              {allowed.cancel &&
                (confirmCancelId === request.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 text-xs"
                      disabled={busy}
                      onClick={() => actionMutation.mutate({ id: request.id, action: "cancel" })}
                    >
                      {intl.formatMessage({ id: "leave.action.confirmCancel" })}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={busy} onClick={() => setConfirmCancelId(null)}>
                      {intl.formatMessage({ id: "leave.action.keep" })}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={busy} onClick={() => setConfirmCancelId(request.id)}>
                    {intl.formatMessage({ id: "leave.action.cancelRequest" })}
                  </Button>
                ))}
            </div>
          );
        },
      },
    ] satisfies ColumnDef<LeaveRequestResponse>[]).map((column) => ({
      ...column,
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, actionMutation.isPending, confirmCancelId],
  );

  const employees = employeesQuery.data ?? [];
  const page = requestsQuery.data;
  const loadError = requestsQuery.isError
    ? getApiErrorMessage(requestsQuery.error, intl.formatMessage({ id: "leave.requests.loadError" }))
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="leave-state-filter">{intl.formatMessage({ id: "leave.field.state" })}</Label>
            <Select id="leave-state-filter" className="w-40" value={stateFilter} onChange={(e) => setFilter("state", e.target.value === "Pending" ? "" : e.target.value)}>
              {LEAVE_STATES.map((s) => (
                <option key={s} value={s}>
                  {intl.formatMessage({ id: `leave.state.${s}` })}
                </option>
              ))}
              <option value={ALL_STATES}>{intl.formatMessage({ id: "leave.filter.allStates" })}</option>
            </Select>
          </div>
          <EmployeeFilter value={employeeFilter} onChange={(v) => setFilter("employee", v)} employees={employees} />
        </div>
        <Button onClick={() => setFormOpen((open) => !open)}>{intl.formatMessage({ id: "leave.requests.new" })}</Button>
      </div>

      {formOpen && (
        <NewLeaveRequestForm
          companyId={companyId}
          employees={employees}
          leaveTypes={(typesQuery.data ?? []).filter((t) => t.isActive)}
          defaultEmployeeId={employeeFilter}
          onDone={async () => {
            setFormOpen(false);
            await refreshAll();
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {(loadError || actionError) && (
        <Alert variant="destructive">
          <AlertDescription>{loadError ?? actionError}</AlertDescription>
        </Alert>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={page?.items ?? []}
        rowCount={page?.total ?? 0}
        isLoading={requestsQuery.isPending}
        getRowId={(row) => row.id}
        getRowClassName={(row) =>
          row.state === "Cancelled" ? "text-muted-foreground line-through" : row.state === "Rejected" ? "text-muted-foreground" : undefined
        }
        emptyMessage={intl.formatMessage({ id: "leave.requests.empty" })}
        exportFileName="leave-requests"
        defaultPageSize={DEFAULT_PAGE_SIZE}
        pageSizeOptions={[25, 50, 100, 200]}
      />
    </div>
  );
}

export function EmployeeFilter({
  value,
  onChange,
  employees,
}: {
  value: string;
  onChange: (value: string) => void;
  employees: { id: string; name: string }[];
}) {
  const intl = useIntl();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="leave-employee-filter">{intl.formatMessage({ id: "leave.field.employee" })}</Label>
      <Select id="leave-employee-filter" className="w-56" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{intl.formatMessage({ id: "leave.filter.allEmployees" })}</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

function NewLeaveRequestForm({
  companyId,
  employees,
  leaveTypes,
  defaultEmployeeId,
  onDone,
  onCancel,
}: {
  companyId: string;
  employees: { id: string; name: string }[];
  leaveTypes: { id: string; code: string; name: string }[];
  defaultEmployeeId: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createLeaveRequest(companyId, {
        employeeId,
        leaveTypeId,
        startDate,
        endDate,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      setError(null);
      await onDone();
    },
    // The server computes working days (weekends + public holidays excluded) and refuses
    // overlaps and over-balance requests — its message is what the user needs to read.
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "leave.requests.createError" }))),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!employeeId || !leaveTypeId || !startDate || !endDate) {
      setError(intl.formatMessage({ id: "leave.requests.missingFields" }));
      return;
    }
    if (endDate < startDate) {
      setError(intl.formatMessage({ id: "leave.requests.endBeforeStart" }));
      return;
    }
    mutation.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "leave.requests.new" })}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-new-employee">{intl.formatMessage({ id: "leave.field.employee" })}</Label>
              <Select id="leave-new-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{intl.formatMessage({ id: "leave.form.selectEmployee" })}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-new-type">{intl.formatMessage({ id: "leave.field.type" })}</Label>
              <Select id="leave-new-type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
                <option value="">{intl.formatMessage({ id: "leave.form.selectType" })}</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-new-start">{intl.formatMessage({ id: "leave.field.startDate" })}</Label>
              <Input
                id="leave-new-start"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate || endDate < e.target.value) setEndDate(e.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-new-end">{intl.formatMessage({ id: "leave.field.endDate" })}</Label>
              <Input id="leave-new-end" type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="leave-new-reason">{intl.formatMessage({ id: "leave.field.reason" })}</Label>
            <Input id="leave-new-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "leave.requests.workingDaysHint" })}</p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={mutation.isPending}>
              {intl.formatMessage({ id: "leave.requests.submit" })}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
