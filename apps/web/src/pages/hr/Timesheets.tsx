import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { TimeEntryResponse, TimesheetImportResponse, TimesheetSummaryRow } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { EmployeePicker } from "@/components/EmployeePicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { formatPayrollMonth } from "@/lib/payroll-enums";

// Mirrors TimeEntryKind (numeric on the wire).
const KINDS = ["Regular", "Overtime", "Night", "Weekend", "Holiday"] as const;

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const hours = (value: number) => (value === 0 ? "—" : String(value));

// G12: hours by day and kind — typed here or imported from a clock system — approved per month
// into the overtime / night / weekend / holiday adjustments payroll uses.
export function Timesheets() {
  const intl = useIntl();
  const { activeCompanyId: companyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") ?? thisMonth();
  const monthStart = `${month}-01`;

  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryHours, setEntryHours] = useState("");
  const [kind, setKind] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<TimesheetImportResponse | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["timesheets", "summary", companyId, month],
    queryFn: () => apiClient.getTimesheetSummary(companyId as string, monthStart),
    enabled: !!companyId,
  });
  const entriesQuery = useQuery({
    queryKey: ["timesheets", "entries", companyId, month],
    queryFn: () => apiClient.listTimeEntries(companyId as string, monthStart, undefined),
    enabled: !!companyId,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["timesheets"] });
  const onError = (fallback: string) => (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: fallback })));

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createTimeEntry(companyId as string, {
        employeeId,
        date,
        hours: Number(entryHours.replace(",", ".")),
        kind: kind === "" ? undefined : KINDS.indexOf(kind as (typeof KINDS)[number]),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setError(null);
      setEntryHours("");
      setNote("");
      refresh();
    },
    onError: onError("timesheets.saveError"),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteTimeEntry(companyId as string, id),
    onSuccess: refresh,
    onError: onError("timesheets.deleteError"),
  });
  const approveMutation = useMutation({
    mutationFn: () => apiClient.approveTimesheetMonth(companyId as string, { month: monthStart, employeeId: undefined }),
    onSuccess: () => {
      setError(null);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["payrollAdjustments"] });
    },
    onError: onError("timesheets.approveError"),
  });
  const importMutation = useMutation({
    mutationFn: (file: File) => apiClient.importTimeEntries(companyId as string, { data: file, fileName: file.name }),
    onSuccess: (result) => {
      setImportResult(result);
      refresh();
    },
    onError: onError("timesheets.importError"),
  });

  const kindLabel = (value: number | string) => intl.formatMessage({ id: `timesheets.kind.${typeof value === "number" ? KINDS[value] : value}` });

  const summaryColumns = useMemo<ColumnDef<TimesheetSummaryRow>[]>(
    () => [
      { accessorKey: "employeeName", header: intl.formatMessage({ id: "me.leave.employee" }) },
      ...KINDS.map(
        (k) =>
          ({
            accessorKey: k.charAt(0).toLowerCase() + k.slice(1),
            header: kindLabel(k),
            meta: { numeric: true },
            cell: ({ getValue }) => hours(getValue() as number),
          }) as ColumnDef<TimesheetSummaryRow>,
      ),
      {
        id: "status",
        header: intl.formatMessage({ id: "me.payslips.status" }),
        cell: ({ row }) =>
          row.original.locked ? (
            <Badge variant="info">{intl.formatMessage({ id: "timesheets.locked" })}</Badge>
          ) : row.original.unapproved > 0 ? (
            <Badge variant="warning">{intl.formatMessage({ id: "timesheets.unapproved" }, { count: row.original.unapproved })}</Badge>
          ) : (
            <Badge variant="success">{intl.formatMessage({ id: "timesheets.approved" })}</Badge>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const entryColumns = useMemo<ColumnDef<TimeEntryResponse>[]>(
    () => [
      { accessorKey: "employeeName", header: intl.formatMessage({ id: "me.leave.employee" }), meta: { groupable: true } },
      { accessorKey: "date", header: intl.formatMessage({ id: "expenses.line.date" }) },
      { accessorKey: "kind", header: intl.formatMessage({ id: "timesheets.kindLabel" }), cell: ({ getValue }) => kindLabel(getValue() as number) },
      { accessorKey: "hours", header: intl.formatMessage({ id: "timesheets.hours" }), meta: { numeric: true } },
      { accessorKey: "note", header: intl.formatMessage({ id: "timesheets.note" }), cell: ({ getValue }) => (getValue() as string) || "—" },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.approved ? (
            <Badge variant="success">{intl.formatMessage({ id: "timesheets.approved" })}</Badge>
          ) : canWrite("hr") ? (
            <Button size="xs" variant="ghost" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(row.original.id)}>
              {intl.formatMessage({ id: "common.delete" })}
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, deleteMutation.isPending],
  );

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!employeeId || !date || !entryHours) {
      setError(intl.formatMessage({ id: "timesheets.missingFields" }));
      return;
    }
    createMutation.mutate();
  }

  if (!companyId) return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  const summary = summaryQuery.data ?? [];
  const entries = entriesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <CardTitle>{intl.formatMessage({ id: "nav.timesheets" })}</CardTitle>
              <CardDescription>{intl.formatMessage({ id: "timesheets.description" }, { month: formatPayrollMonth(month, intl) })}</CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="timesheet-month">{intl.formatMessage({ id: "payroll.month" })}</Label>
                <Input id="timesheet-month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && setSearchParams({ month: e.target.value }, { replace: true })} />
              </div>
              {canWrite("hr") && (
                <>
                  <label className="inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm">
                    {intl.formatMessage({ id: "timesheets.import" })}
                    <input
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) importMutation.mutate(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <Button
                    hidden={!canApprove("hr")}
                    disabled={approveMutation.isPending || summary.length === 0}
                    onClick={() => {
                      if (window.confirm(intl.formatMessage({ id: "timesheets.approveConfirm" }, { month: formatPayrollMonth(month, intl) }))) approveMutation.mutate();
                    }}
                  >
                    {intl.formatMessage({ id: "timesheets.approveMonth" })}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {importResult && (
            <Alert variant={importResult.errors.length ? "destructive" : "default"}>
              <AlertDescription>
                {intl.formatMessage({ id: "timesheets.importDone" }, { imported: importResult.imported, errors: importResult.errors.length })}
                {importResult.errors.slice(0, 10).map((err) => (
                  <span key={err.line} className="block text-xs">
                    {intl.formatMessage({ id: "timesheets.importLine" }, { line: err.line })} {err.message}
                  </span>
                ))}
              </AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "timesheets.importHint" })}</p>
          <DataGrid
            gridId="timesheet-summary"
            columns={summaryColumns}
            data={summary}
            rowCount={summary.length}
            isLoading={summaryQuery.isPending}
            getRowId={(row) => row.employeeId}
            emptyMessage={intl.formatMessage({ id: "timesheets.empty" })}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "timesheets.entries" })}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canWrite("hr") && (
            <form className="grid grid-cols-1 gap-2 sm:grid-cols-6 sm:items-end" onSubmit={handleAdd}>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor="te-employee">{intl.formatMessage({ id: "me.leave.employee" })}</Label>
                <EmployeePicker companyId={companyId} id="te-employee" value={employeeId} onChange={(id) => setEmployeeId(id)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="te-date">{intl.formatMessage({ id: "expenses.line.date" })}</Label>
                <Input id="te-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="te-hours">{intl.formatMessage({ id: "timesheets.hours" })}</Label>
                <Input id="te-hours" inputMode="decimal" className="text-right tabular-nums" value={entryHours} onChange={(e) => setEntryHours(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="te-kind">{intl.formatMessage({ id: "timesheets.kindLabel" })}</Label>
                <select id="te-kind" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">{intl.formatMessage({ id: "timesheets.kindAuto" })}</option>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {intl.formatMessage({ id: "timesheets.add" })}
              </Button>
              <div className="flex flex-col gap-1 sm:col-span-6">
                <Input aria-label={intl.formatMessage({ id: "timesheets.note" })} placeholder={intl.formatMessage({ id: "timesheets.note" })} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </form>
          )}
          <DataGrid
            gridId="timesheet-entries"
            columns={entryColumns}
            data={entries}
            rowCount={entries.length}
            isLoading={entriesQuery.isPending}
            getRowId={(row) => row.id}
            emptyMessage={intl.formatMessage({ id: "timesheets.empty" })}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}
