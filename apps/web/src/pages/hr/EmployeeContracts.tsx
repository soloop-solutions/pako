import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { EmployeeContractResponse, EmployeeDetailResponse, SaveEmployeeContractRequest } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EmploymentType, employmentTypeLabel, employmentTypeValues } from "@/lib/hr-enums";

/** Dated salary history. The contract covering today sets the employee's current salary. */
export function EmployeeContracts({
  companyId,
  employee,
  readOnly,
}: {
  companyId: string;
  employee: EmployeeDetailResponse;
  readOnly: boolean;
}) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<EmployeeContractResponse | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const contractsQueryKey = ["employeeContracts", companyId, employee.id] as const;
  const contractsQuery = useQuery({
    queryKey: contractsQueryKey,
    queryFn: () => apiClient.listEmployeeContracts(companyId, employee.id),
  });
  const contracts = useMemo(() => contractsQuery.data ?? [], [contractsQuery.data]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: contractsQueryKey });
    // Current salary and the minimum-wage warning come from the contracts — reload the employee.
    await queryClient.invalidateQueries({ queryKey: ["employee", companyId, employee.id] });
    await queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
  }

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string | null; request: SaveEmployeeContractRequest }) =>
      vars.id
        ? apiClient.updateEmployeeContract(companyId, employee.id, vars.id, vars.request)
        : apiClient.createEmployeeContract(companyId, employee.id, vars.request),
    onSuccess: async () => {
      setError(null);
      setEditing(null);
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "hr.contracts.saveError" }))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteEmployeeContract(companyId, employee.id, id),
    onSuccess: async () => {
      setError(null);
      setConfirmDeleteId(null);
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "hr.contracts.deleteError" }))),
  });

  const columns = useMemo<ColumnDef<EmployeeContractResponse>[]>(
    () => [
      {
        accessorKey: "startDate",
        header: intl.formatMessage({ id: "hr.contract.startDate" }),
        cell: ({ getValue }) => <span className="tabular-nums">{getValue() as string}</span>,
      },
      {
        accessorKey: "endDate",
        header: intl.formatMessage({ id: "hr.contract.endDate" }),
        cell: ({ getValue }) => <span className="tabular-nums">{(getValue() as string | undefined) || "—"}</span>,
      },
      {
        accessorKey: "monthlyGrossSalary",
        header: intl.formatMessage({ id: "hr.employee.monthlyGrossSalary" }),
        enableColumnFilter: false,
        meta: { numeric: true },
        cell: ({ getValue }) => `${(getValue() as number).toFixed(2)} €`,
      },
      {
        id: "employmentType",
        header: intl.formatMessage({ id: "hr.contract.employmentType" }),
        accessorFn: (row) => employmentTypeLabel(row.employmentType, intl),
      },
      {
        accessorKey: "weeklyHours",
        header: intl.formatMessage({ id: "hr.contract.weeklyHours" }),
        enableColumnFilter: false,
        meta: { numeric: true },
      },
      {
        accessorKey: "jobTitle",
        header: intl.formatMessage({ id: "hr.employee.jobTitle" }),
        cell: ({ getValue }) => (getValue() as string | undefined) || "—",
      },
      {
        accessorKey: "notes",
        header: intl.formatMessage({ id: "hr.contract.notes" }),
        cell: ({ getValue }) => <span className="block max-w-64 truncate">{(getValue() as string | undefined) || "—"}</span>,
      },
      {
        id: "current",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        accessorFn: (row) => (row.isCurrent ? intl.formatMessage({ id: "hr.contract.current" }) : ""),
        cell: ({ row }) => (row.original.isCurrent ? <Badge variant="info">{intl.formatMessage({ id: "hr.contract.current" })}</Badge> : null),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) =>
          readOnly ? null : confirmDeleteId === row.original.id ? (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="destructive"
                className="h-6 text-xs"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(row.original.id)}
              >
                {intl.formatMessage({ id: "hr.common.confirmDelete" })}
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setConfirmDeleteId(null)}>
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
            </div>
          ) : (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => {
                  setEditing(row.original);
                  setError(null);
                }}
              >
                {intl.formatMessage({ id: "common.edit" })}
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setConfirmDeleteId(row.original.id)}>
                {intl.formatMessage({ id: "common.delete" })}
              </Button>
            </div>
          ),
      },
    ],
    [intl, readOnly, confirmDeleteId, deleteMutation],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: "hr.contracts.hint" }, { salary: `${employee.currentSalary.toFixed(2)} €` })}
        </p>
        {!readOnly && editing === null && (
          <Button
            size="sm"
            onClick={() => {
              setEditing("new");
              setError(null);
            }}
          >
            {intl.formatMessage({ id: "hr.contracts.add" })}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {editing !== null && !readOnly && (
        <ContractForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          defaultJobTitle={employee.jobTitle}
          submitting={saveMutation.isPending}
          onSubmit={(request) => saveMutation.mutate({ id: editing === "new" ? null : editing.id, request })}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}

      <DataGrid
        gridId="employeeContracts"
        columns={columns}
        data={contracts}
        rowCount={contracts.length}
        isLoading={contractsQuery.isPending}
        getRowId={(row) => row.id}
        getRowClassName={(row) => (row.isCurrent ? "font-medium" : undefined)}
        emptyMessage={intl.formatMessage({ id: "hr.contracts.empty" })}
        exportFileName={`contracts-${employee.name}`}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={50}
      />
    </div>
  );
}

function ContractForm({
  initial,
  defaultJobTitle,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: EmployeeContractResponse | null;
  defaultJobTitle: string | undefined;
  submitting: boolean;
  onSubmit: (request: SaveEmployeeContractRequest) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [salary, setSalary] = useState(initial ? String(initial.monthlyGrossSalary) : "");
  const [employmentType, setEmploymentType] = useState<number>(initial?.employmentType ?? EmploymentType.FullTime);
  const [weeklyHours, setWeeklyHours] = useState(initial ? String(initial.weeklyHours) : "40");
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? defaultJobTitle ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      startDate,
      endDate: endDate || undefined,
      monthlyGrossSalary: Number(salary),
      employmentType,
      weeklyHours: Number(weeklyHours),
      jobTitle: jobTitle.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form className="flex flex-col gap-3 rounded-md border p-3" onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="contract-start">{intl.formatMessage({ id: "hr.contract.startDate" })}</Label>
          <Input id="contract-start" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contract-end">{intl.formatMessage({ id: "hr.contract.endDate" })}</Label>
          <Input id="contract-end" type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contract-salary">{intl.formatMessage({ id: "hr.employee.monthlyGrossSalary" })}</Label>
          <Input
            id="contract-salary"
            type="number"
            min="0.01"
            step="0.01"
            required
            className="text-right tabular-nums"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contract-type">{intl.formatMessage({ id: "hr.contract.employmentType" })}</Label>
          <Select id="contract-type" value={employmentType} onChange={(e) => setEmploymentType(Number(e.target.value))}>
            {employmentTypeValues.map((value) => (
              <option key={value} value={value}>
                {employmentTypeLabel(value, intl)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contract-hours">{intl.formatMessage({ id: "hr.contract.weeklyHours" })}</Label>
          <Input
            id="contract-hours"
            type="number"
            min="1"
            max="60"
            step="0.5"
            required
            className="text-right tabular-nums"
            value={weeklyHours}
            onChange={(e) => setWeeklyHours(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contract-job-title">{intl.formatMessage({ id: "hr.employee.jobTitle" })}</Label>
          <Input id="contract-job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="contract-notes">{intl.formatMessage({ id: "hr.contract.notes" })}</Label>
          <Input id="contract-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting || !startDate || !salary || !weeklyHours}>
          {submitting
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: initial ? "common.save" : "hr.contracts.add" })}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={submitting}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
      </div>
    </form>
  );
}
