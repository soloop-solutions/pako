import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { LeaveBalanceResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EmployeeFilter } from "@/pages/leave/LeaveRequestsTab";
import { parseYear, remainingTone, useLeaveEmployees, useLeaveTypes, yearOptions } from "@/pages/leave/leaveShared";

const GRID_ID = "leaveBalances";

function balanceKey(row: { employeeId: string; leaveTypeId: string }) {
  return `${row.employeeId}:${row.leaveTypeId}`;
}

export function LeaveBalancesTab({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const year = parseYear(searchParams.get("year"));
  const employeeFilter = searchParams.get("employee") ?? "";

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  // Enter commits (or Escape reverts) and the input then blurs — the ref stops that blur from
  // committing a second time.
  const committingRef = useRef(false);

  const employeesQuery = useLeaveEmployees(companyId);
  const typesQuery = useLeaveTypes(companyId);

  const balancesQuery = useQuery({
    queryKey: ["leave", "balances", companyId, year, employeeFilter],
    queryFn: () => apiClient.listLeaveBalances(companyId, year, employeeFilter || undefined),
  });

  function setParam(key: "year" | "employee", value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (!value) params.delete(key);
        else params.set(key, value);
        return params;
      },
      { replace: true },
    );
  }

  const allocationMutation = useMutation({
    mutationFn: (vars: { employeeId: string; leaveTypeId: string; days: number }) =>
      apiClient.setLeaveAllocation(companyId, { ...vars, year }),
    onSuccess: async () => {
      setError(null);
      setEditingKey(null);
      await queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "leave.balances.saveError" }))),
  });

  function startEdit(row: LeaveBalanceResponse) {
    committingRef.current = false;
    setEditingKey(balanceKey(row));
    setDraft(String(row.allocated));
    setError(null);
  }

  function commitEdit(row: LeaveBalanceResponse) {
    if (committingRef.current) return;
    const days = Number(draft.replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(days) || days < 0) {
      setError(intl.formatMessage({ id: "leave.balances.invalidDays" }));
      return;
    }
    if (days === row.allocated) {
      setEditingKey(null);
      return;
    }
    committingRef.current = true;
    allocationMutation.mutate(
      { employeeId: row.employeeId, leaveTypeId: row.leaveTypeId, days },
      { onError: () => (committingRef.current = false) }, // stays set on success until the next edit starts
    );
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>, row: LeaveBalanceResponse) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      committingRef.current = true; // the unmount blur must not commit the reverted draft
      setEditingKey(null);
      setError(null);
    }
  }

  const columns = useMemo<ColumnDef<LeaveBalanceResponse>[]>(
    () => [
      { accessorKey: "employeeName", header: intl.formatMessage({ id: "leave.field.employee" }), meta: { groupable: true } },
      { accessorKey: "leaveTypeName", header: intl.formatMessage({ id: "leave.field.type" }), meta: { groupable: true } },
      {
        accessorKey: "allocated",
        header: intl.formatMessage({ id: "leave.field.allocated" }),
        meta: { numeric: true },
        enableGrouping: false,
        cell: ({ row }) => {
          const balance = row.original;
          if (editingKey === balanceKey(balance)) {
            return (
              <Input
                autoFocus
                aria-label={intl.formatMessage({ id: "leave.field.allocated" })}
                inputMode="decimal"
                className="ml-auto h-6 w-20 text-right tabular-nums"
                value={draft}
                disabled={allocationMutation.isPending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => handleEditKeyDown(e, balance)}
                onBlur={() => commitEdit(balance)}
              />
            );
          }
          return (
            <button
              type="button"
              className="w-full text-right tabular-nums underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground"
              title={intl.formatMessage({ id: "leave.balances.editHint" })}
              onClick={() => startEdit(balance)}
            >
              {balance.allocated}
            </button>
          );
        },
      },
      { accessorKey: "taken", header: intl.formatMessage({ id: "leave.field.taken" }), meta: { numeric: true }, enableGrouping: false },
      { accessorKey: "pending", header: intl.formatMessage({ id: "leave.field.pending" }), meta: { numeric: true }, enableGrouping: false },
      {
        accessorKey: "remaining",
        header: intl.formatMessage({ id: "leave.field.remaining" }),
        meta: { numeric: true },
        enableGrouping: false,
        cell: ({ row }) => {
          const tone = remainingTone(row.original);
          return (
            <span
              className={cn(
                "tabular-nums",
                tone === "negative" && "font-semibold text-destructive",
                tone === "low" && "font-semibold text-warning-foreground",
              )}
              title={tone ? intl.formatMessage({ id: `leave.balances.${tone}` }) : undefined}
            >
              {row.original.remaining}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, editingKey, draft, allocationMutation.isPending],
  );

  const balances = balancesQuery.data ?? [];
  const loadError = balancesQuery.isError
    ? getApiErrorMessage(balancesQuery.error, intl.formatMessage({ id: "leave.balances.loadError" }))
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="leave-balances-year">{intl.formatMessage({ id: "leave.field.year" })}</Label>
            <Select
              id="leave-balances-year"
              className="w-28"
              value={String(year)}
              onValueChange={(v) => setParam("year", v)}
              options={yearOptions(year).map((y) => ({
                value: String(y),
                label: String(y),
              }))}
            />
          </div>
          <EmployeeFilter value={employeeFilter} onChange={(v) => setParam("employee", v)} employees={employeesQuery.data ?? []} />
        </div>
        <Button variant="outline" onClick={() => setFormOpen((open) => !open)}>
          {intl.formatMessage({ id: "leave.balances.setAllocation" })}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "leave.balances.hint" })}</p>

      {formOpen && (
        <SetAllocationForm
          year={year}
          employees={employeesQuery.data ?? []}
          leaveTypes={(typesQuery.data ?? []).filter((t) => t.isActive)}
          defaultEmployeeId={employeeFilter}
          submitting={allocationMutation.isPending}
          onSubmit={(vars) => allocationMutation.mutate(vars, { onSuccess: () => setFormOpen(false) })}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {(loadError || error) && (
        <Alert variant="destructive">
          <AlertDescription>{loadError ?? error}</AlertDescription>
        </Alert>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={balances}
        rowCount={balances.length}
        isLoading={balancesQuery.isPending}
        getRowId={balanceKey}
        getRowClassName={(row) => (row.remaining < 0 ? "bg-destructive/5" : undefined)}
        emptyMessage={intl.formatMessage({ id: "leave.balances.empty" })}
        exportFileName={`leave-balances-${year}`}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={200}
        pageSizeOptions={[200]}
      />
    </div>
  );
}

function SetAllocationForm({
  year,
  employees,
  leaveTypes,
  defaultEmployeeId,
  submitting,
  onSubmit,
  onCancel,
}: {
  year: number;
  employees: { id: string; name: string }[];
  leaveTypes: { id: string; code: string; name: string }[];
  defaultEmployeeId: string;
  submitting: boolean;
  onSubmit: (vars: { employeeId: string; leaveTypeId: string; days: number }) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(days.replace(",", "."));
    if (!employeeId || !leaveTypeId || days.trim() === "") {
      setError(intl.formatMessage({ id: "leave.requests.missingFields" }));
      return;
    }
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(intl.formatMessage({ id: "leave.balances.invalidDays" }));
      return;
    }
    setError(null);
    onSubmit({ employeeId, leaveTypeId, days: parsed });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "leave.balances.setAllocationTitle" }, { year })}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-alloc-employee">{intl.formatMessage({ id: "leave.field.employee" })}</Label>
              <Select
                id="leave-alloc-employee"
                value={employeeId}
                onValueChange={(v) => setEmployeeId(v)}
                placeholder={intl.formatMessage({ id: "leave.form.selectEmployee" })}
                options={employees.map((e) => ({
                  value: e.id,
                  label: e.name,
                }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-alloc-type">{intl.formatMessage({ id: "leave.field.type" })}</Label>
              <Select
                id="leave-alloc-type"
                value={leaveTypeId}
                onValueChange={(v) => setLeaveTypeId(v)}
                placeholder={intl.formatMessage({ id: "leave.form.selectType" })}
                options={leaveTypes.map((t) => ({
                  value: t.id,
                  label: `${t.code} — ${t.name}`,
                }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-alloc-days">{intl.formatMessage({ id: "leave.field.allocatedDays" })}</Label>
              <Input id="leave-alloc-days" inputMode="decimal" className="text-right tabular-nums" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={submitting}>
              {intl.formatMessage({ id: "common.save" })}
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
