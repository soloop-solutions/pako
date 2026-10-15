import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { LeaveTypeResponse, PublicHolidayResponse, SaveLeaveTypeRequest } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDate, leaveTypesQueryKey, parseYear, useLeaveTypes, yearOptions } from "@/pages/leave/leaveShared";

export function LeaveSettingsTab({ companyId }: { companyId: string }) {
  return (
    <div className="space-y-8">
      <LeaveTypesSection companyId={companyId} />
      <PublicHolidaysSection companyId={companyId} />
    </div>
  );
}

// ---- Leave types ----

function LeaveTypesSection({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const typesQuery = useLeaveTypes(companyId);
  const [editing, setEditing] = useState<LeaveTypeResponse | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: SaveLeaveTypeRequest }) =>
      id ? apiClient.updateLeaveType(companyId, id, body) : apiClient.createLeaveType(companyId, body),
    onSuccess: async () => {
      setError(null);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: leaveTypesQueryKey(companyId) });
      // A type's default days and active flag change which balance rows exist.
      await queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "leave.types.saveError" }))),
  });

  const editingId = editing && editing !== "new" ? editing.id : null;

  const columns = useMemo<ColumnDef<LeaveTypeResponse>[]>(
    () => [
      {
        accessorKey: "code",
        header: intl.formatMessage({ id: "leave.field.code" }),
        cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
      },
      { accessorKey: "name", header: intl.formatMessage({ id: "leave.field.name" }) },
      {
        accessorKey: "defaultAnnualDays",
        header: intl.formatMessage({ id: "leave.field.defaultAnnualDays" }),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const value = getValue();
          return typeof value === "number" ? value : <span className="text-muted-foreground">—</span>;
        },
      },
      {
        accessorKey: "payPercent",
        header: intl.formatMessage({ id: "leave.field.payPercent" }),
        meta: { numeric: true },
        cell: ({ getValue }) => `${getValue() as number}%`,
      },
      {
        id: "isActive",
        accessorFn: (row) => intl.formatMessage({ id: row.isActive ? "leave.types.active" : "leave.types.inactive" }),
        header: intl.formatMessage({ id: "leave.field.status" }),
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge variant="success">{intl.formatMessage({ id: "leave.types.active" })}</Badge>
          ) : (
            <Badge variant="draft">{intl.formatMessage({ id: "leave.types.inactive" })}</Badge>
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            disabled={editingId !== null && editingId !== row.original.id}
            onClick={() => {
              setEditing(row.original);
              setError(null);
            }}
          >
            {intl.formatMessage({ id: "common.edit" })}
          </Button>
        ),
      },
    ],
    [intl, editingId],
  );

  const types = typesQuery.data ?? [];
  const loadError = typesQuery.isError ? getApiErrorMessage(typesQuery.error, intl.formatMessage({ id: "leave.types.loadError" })) : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{intl.formatMessage({ id: "leave.types.title" })}</h3>
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "leave.types.description" })}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setEditing((current) => (current === "new" ? null : "new"));
            setError(null);
          }}
        >
          {intl.formatMessage({ id: "leave.types.add" })}
        </Button>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {editing && (
        <LeaveTypeForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          submitting={saveMutation.isPending}
          error={error}
          onSubmit={(body) => saveMutation.mutate({ id: editing === "new" ? null : editing.id, body })}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}

      <DataGrid
        gridId="leaveTypes"
        columns={columns}
        data={types}
        rowCount={types.length}
        isLoading={typesQuery.isPending}
        getRowId={(row) => row.id}
        getRowClassName={(row) => (row.isActive ? undefined : "text-muted-foreground")}
        emptyMessage={intl.formatMessage({ id: "leave.types.empty" })}
        exportFileName="leave-types"
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={100}
        pageSizeOptions={[100]}
      />
    </section>
  );
}

function LeaveTypeForm({
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial: LeaveTypeResponse | null;
  submitting: boolean;
  error: string | null;
  onSubmit: (body: SaveLeaveTypeRequest) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [defaultAnnualDays, setDefaultAnnualDays] = useState(
    initial?.defaultAnnualDays === undefined || initial?.defaultAnnualDays === null ? "" : String(initial.defaultAnnualDays),
  );
  const [payPercent, setPayPercent] = useState(initial ? String(initial.payPercent) : "100");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [localError, setLocalError] = useState<string | null>(null);

  function parseNumber(raw: string): number {
    return Number(raw.trim().replace(",", "."));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim() || !name.trim()) {
      setLocalError(intl.formatMessage({ id: "leave.types.codeNameRequired" }));
      return;
    }
    const days = defaultAnnualDays.trim() === "" ? undefined : parseNumber(defaultAnnualDays);
    if (days !== undefined && (!Number.isFinite(days) || days < 0)) {
      setLocalError(intl.formatMessage({ id: "leave.balances.invalidDays" }));
      return;
    }
    const pay = parseNumber(payPercent);
    if (payPercent.trim() === "" || !Number.isFinite(pay) || pay < 0 || pay > 100) {
      setLocalError(intl.formatMessage({ id: "leave.types.invalidPayPercent" }));
      return;
    }
    setLocalError(null);
    onSubmit({ code: code.trim(), name: name.trim(), defaultAnnualDays: days, payPercent: pay, isActive });
  }

  const shownError = localError ?? error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {initial ? intl.formatMessage({ id: "leave.types.editTitle" }, { name: initial.name }) : intl.formatMessage({ id: "leave.types.add" })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-type-code">{intl.formatMessage({ id: "leave.field.code" })}</Label>
              <Input id="leave-type-code" className="font-mono uppercase" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-type-name">{intl.formatMessage({ id: "leave.field.name" })}</Label>
              <Input id="leave-type-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-type-days">{intl.formatMessage({ id: "leave.field.defaultAnnualDays" })}</Label>
              <Input
                id="leave-type-days"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={defaultAnnualDays}
                onChange={(e) => setDefaultAnnualDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "leave.types.defaultDaysHint" })}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="leave-type-pay">{intl.formatMessage({ id: "leave.field.payPercent" })}</Label>
              <Input id="leave-type-pay" inputMode="decimal" className="text-right tabular-nums" value={payPercent} onChange={(e) => setPayPercent(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {intl.formatMessage({ id: "leave.types.active" })}
          </label>
          {shownError && (
            <Alert variant="destructive">
              <AlertDescription>{shownError}</AlertDescription>
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

// ---- Public holidays ----

function PublicHolidaysSection({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const year = parseYear(searchParams.get("holidayYear"));

  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const holidaysQuery = useQuery({
    queryKey: ["leave", "holidays", companyId, year],
    queryFn: () => apiClient.listPublicHolidays(companyId, year),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["leave", "holidays"] });
  }

  const createMutation = useMutation({
    mutationFn: () => apiClient.createPublicHoliday(companyId, { date, name: name.trim() }),
    onSuccess: async () => {
      setError(null);
      setDate("");
      setName("");
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "leave.holidays.saveError" }))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deletePublicHoliday(companyId, id),
    onSuccess: async () => {
      setError(null);
      setConfirmDeleteId(null);
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "leave.holidays.deleteError" }))),
  });

  function setYear(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("holidayYear", value);
        return params;
      },
      { replace: true },
    );
  }

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!date || !name.trim()) {
      setError(intl.formatMessage({ id: "leave.holidays.dateNameRequired" }));
      return;
    }
    createMutation.mutate();
  }

  const columns = useMemo<ColumnDef<PublicHolidayResponse>[]>(
    () => [
      {
        accessorKey: "date",
        header: intl.formatMessage({ id: "leave.field.date" }),
        cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue() as string)}</span>,
      },
      {
        id: "weekday",
        header: intl.formatMessage({ id: "leave.field.weekday" }),
        enableSorting: false,
        accessorFn: (row) => {
          const [y, m, d] = formatDate(row.date).split("-").map(Number);
          return new Intl.DateTimeFormat(intl.locale, { weekday: "long" }).format(new Date(y, m - 1, d));
        },
      },
      { accessorKey: "name", header: intl.formatMessage({ id: "leave.field.name" }) },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) =>
          confirmDeleteId === row.original.id ? (
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="destructive"
                className="h-6 text-xs"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(row.original.id)}
              >
                {intl.formatMessage({ id: "leave.holidays.confirmDelete" })}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setConfirmDeleteId(null)}>
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setConfirmDeleteId(row.original.id)}>
                {intl.formatMessage({ id: "common.delete" })}
              </Button>
            </div>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, confirmDeleteId, deleteMutation.isPending],
  );

  const holidays = holidaysQuery.data ?? [];
  const loadError = holidaysQuery.isError
    ? getApiErrorMessage(holidaysQuery.error, intl.formatMessage({ id: "leave.holidays.loadError" }))
    : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{intl.formatMessage({ id: "leave.holidays.title" })}</h3>
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "leave.holidays.description" })}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="leave-holidays-year">{intl.formatMessage({ id: "leave.field.year" })}</Label>
          <Select id="leave-holidays-year" className="w-28" value={String(year)} onChange={(e) => setYear(e.target.value)}>
            {yearOptions(year).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleAdd}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="leave-holiday-date">{intl.formatMessage({ id: "leave.field.date" })}</Label>
          <Input id="leave-holiday-date" type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex min-w-[240px] flex-1 flex-col gap-1">
          <Label htmlFor="leave-holiday-name">{intl.formatMessage({ id: "leave.field.name" })}</Label>
          <Input id="leave-holiday-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" variant="outline" disabled={createMutation.isPending}>
          {intl.formatMessage({ id: "leave.holidays.add" })}
        </Button>
      </form>

      {(loadError || error) && (
        <Alert variant="destructive">
          <AlertDescription>{loadError ?? error}</AlertDescription>
        </Alert>
      )}

      <DataGrid
        gridId="leaveHolidays"
        columns={columns}
        data={holidays}
        rowCount={holidays.length}
        isLoading={holidaysQuery.isPending}
        getRowId={(row) => row.id}
        emptyMessage={intl.formatMessage({ id: "leave.holidays.empty" })}
        exportFileName={`public-holidays-${year}`}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={100}
        pageSizeOptions={[100]}
      />
    </section>
  );
}
