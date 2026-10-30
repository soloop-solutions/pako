import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { PayrollAdjustmentResponse, SavePayrollAdjustmentRequest } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatAmount,
  formatPayrollMonth,
  isDeductionKind,
  isHourBasedKind,
  isValidMonth,
  monthBounds,
  payrollAdjustmentKindLabel,
} from "@/lib/payroll-enums";
import { AdjustmentForm } from "@/pages/payroll/AdjustmentForm";
import { CommissionBasisDialog } from "@/pages/payroll/CommissionBasisDialog";

const GRID_ID = "payrollAdjustments";

type PayrollAdjustmentsProps = {
  companyId: string;
  month: string;
  onMonthChange: (month: string) => void;
};

// Bonuses, allowances, hour-based premiums and deductions for one month. A run consumes every
// unconsumed item of its month when it is created or recomputed; consumed items (payrollRunId
// set) are read-only here and link to the run that included them.
export function PayrollAdjustments({ companyId, month, onMonthChange }: PayrollAdjustmentsProps) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const period = monthBounds(month).start;

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [commissionNotice, setCommissionNotice] = useState<string | null>(null);
  const [basisFor, setBasisFor] = useState<PayrollAdjustmentResponse | null>(null);

  const adjustmentsKey = ["payrollAdjustments", companyId, period] as const;
  const adjustmentsQuery = useQuery({
    queryKey: adjustmentsKey,
    queryFn: () => apiClient.listPayrollAdjustments(companyId, period, undefined),
  });
  // Only asks whether the company has any active employee — the form's picker searches itself.
  const employeesQuery = useQuery({
    queryKey: ["employees", companyId, "any"],
    queryFn: () => apiClient.listEmployees(companyId, 1, 1, undefined, undefined, undefined, false, false),
  });

  const adjustments = useMemo(() => adjustmentsQuery.data ?? [], [adjustmentsQuery.data]);
  const editing = editingId ? adjustments.find((a) => a.id === editingId) ?? null : null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: adjustmentsKey });
  }

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string | null; request: SavePayrollAdjustmentRequest }) =>
      vars.id
        ? apiClient.updatePayrollAdjustment(companyId, vars.id, vars.request)
        : apiClient.createPayrollAdjustment(companyId, vars.request),
    onSuccess: async () => {
      setFormError(null);
      setFormOpen(false);
      setEditingId(null);
      await refresh();
    },
    onError: (err: unknown) => setFormError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.adjustment.saveError" }))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deletePayrollAdjustment(companyId, id),
    onSuccess: async () => {
      setRowError(null);
      await refresh();
    },
    onError: (err: unknown) => setRowError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.adjustment.deleteError" }))),
  });

  const commissionMutation = useMutation({
    mutationFn: () => apiClient.calculateCommissions(companyId, { period }),
    onSuccess: async (results) => {
      setRowError(null);
      const created = results.filter((r) => !r.locked && r.amount > 0).length;
      const locked = results.filter((r) => r.locked).length;
      setCommissionNotice(
        results.length === 0
          ? intl.formatMessage({ id: "commission.calculate.none" })
          : intl.formatMessage({ id: "commission.calculate.done" }, { created, locked, total: results.length }),
      );
      await refresh();
    },
    onError: (err: unknown) => setRowError(getApiErrorMessage(err, intl.formatMessage({ id: "commission.calculate.error" }))),
  });

  function handleDelete(adjustment: PayrollAdjustmentResponse) {
    const confirmed = window.confirm(
      intl.formatMessage(
        { id: "payroll.adjustment.confirmDelete" },
        { kind: payrollAdjustmentKindLabel(adjustment.kind, intl), employee: adjustment.employeeName },
      ),
    );
    if (confirmed) deleteMutation.mutate(adjustment.id);
  }

  const columns = useMemo<ColumnDef<PayrollAdjustmentResponse>[]>(
    () => [
      {
        accessorKey: "employeeName",
        header: intl.formatMessage({ id: "payroll.adjustment.employee" }),
      },
      {
        id: "kind",
        header: intl.formatMessage({ id: "payroll.adjustment.kind" }),
        accessorFn: (row) => payrollAdjustmentKindLabel(row.kind, intl),
        cell: ({ row, getValue }) => (
          <Badge variant={isDeductionKind(row.original.kind) ? "warning" : "outline"}>{getValue() as string}</Badge>
        ),
      },
      {
        accessorKey: "description",
        header: intl.formatMessage({ id: "payroll.adjustment.description" }),
        cell: ({ row, getValue }) =>
          row.original.commissionPlanId ? (
            <button type="button" className="text-left text-primary hover:underline" onClick={() => setBasisFor(row.original)}>
              {intl.formatMessage(
                { id: "commission.descriptionWithBasis" },
                { plan: (getValue() as string | undefined) ?? "", basis: formatAmount(row.original.commissionBasisAmount ?? 0) },
              )}
            </button>
          ) : (
            (getValue() as string | undefined) || "—"
          ),
      },
      {
        accessorKey: "hours",
        header: intl.formatMessage({ id: "payroll.adjustment.hours" }),
        meta: { numeric: true },
        cell: ({ row, getValue }) =>
          isHourBasedKind(row.original.kind) && typeof getValue() === "number"
            ? intl.formatNumber(getValue() as number, { maximumFractionDigits: 2 })
            : "—",
      },
      {
        accessorKey: "rateMultiplier",
        header: intl.formatMessage({ id: "payroll.adjustment.multiplier" }),
        meta: { numeric: true },
        cell: ({ row, getValue }) =>
          isHourBasedKind(row.original.kind) && typeof getValue() === "number"
            ? `× ${intl.formatNumber(getValue() as number, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "—",
      },
      {
        accessorKey: "amount",
        header: intl.formatMessage({ id: "payroll.adjustment.amount" }),
        meta: { numeric: true },
        cell: ({ row, getValue }) => {
          const text = formatAmount(getValue() as number);
          return isDeductionKind(row.original.kind) ? <span className="text-destructive">−{text}</span> : text;
        },
      },
      {
        id: "included",
        header: intl.formatMessage({ id: "payroll.adjustment.included" }),
        accessorFn: (row) =>
          intl.formatMessage({ id: row.payrollRunId ? "payroll.adjustment.includedYes" : "payroll.adjustment.includedNo" }),
        cell: ({ row }) =>
          row.original.payrollRunId ? (
            <Link to={`/payroll/${row.original.payrollRunId}`} className="inline-flex">
              <Badge variant="info" className="gap-1">
                <Lock className="size-3" />
                {intl.formatMessage({ id: "payroll.adjustment.includedYes" })}
              </Badge>
            </Link>
          ) : (
            <Badge variant="draft">{intl.formatMessage({ id: "payroll.adjustment.includedNo" })}</Badge>
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.payrollRunId ? null : (
            <div className="flex gap-1">
              <Button
                size="xs"
                variant="outline"
                className="h-6"
                disabled={editingId !== null && editingId !== row.original.id}
                onClick={() => {
                  setEditingId(row.original.id);
                  setFormOpen(false);
                  setFormError(null);
                }}
              >
                {intl.formatMessage({ id: "common.edit" })}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="h-6 text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() => handleDelete(row.original)}
              >
                {intl.formatMessage({ id: "common.delete" })}
              </Button>
            </div>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, editingId, deleteMutation.isPending],
  );

  const loadError = adjustmentsQuery.isError
    ? getApiErrorMessage(adjustmentsQuery.error, intl.formatMessage({ id: "payroll.adjustment.loadError" }))
    : employeesQuery.isError
      ? getApiErrorMessage(employeesQuery.error, intl.formatMessage({ id: "payroll.adjustment.employeesLoadError" }))
      : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>{intl.formatMessage({ id: "payroll.adjustments.title" }, { month: formatPayrollMonth(month, intl) })}</CardTitle>
              <CardDescription>{intl.formatMessage({ id: "payroll.adjustments.description" })}</CardDescription>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payroll-adjustments-month">{intl.formatMessage({ id: "payroll.month" })}</Label>
                <Input
                  id="payroll-adjustments-month"
                  type="month"
                  className="w-44"
                  value={month}
                  onChange={(event) => {
                    if (isValidMonth(event.target.value)) {
                      setEditingId(null);
                      onMonthChange(event.target.value);
                    }
                  }}
                />
              </div>
              <Button size="sm" variant="outline" disabled={commissionMutation.isPending} onClick={() => commissionMutation.mutate()}>
                {intl.formatMessage({ id: "commission.calculate" })}
              </Button>
              {!formOpen && !editing && (
                <Button
                  size="sm"
                  onClick={() => {
                    setFormOpen(true);
                    setFormError(null);
                  }}
                >
                  {intl.formatMessage({ id: "payroll.adjustment.new" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loadError && (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}
          {commissionNotice && (
            <Alert>
              <AlertDescription>{commissionNotice}</AlertDescription>
            </Alert>
          )}
          <CommissionBasisDialog
            companyId={companyId}
            adjustmentId={basisFor?.id ?? null}
            title={basisFor ? intl.formatMessage({ id: "commission.basis.title" }, { employee: basisFor.employeeName }) : ""}
            onClose={() => setBasisFor(null)}
          />
          {employeesQuery.isSuccess && employeesQuery.data.total === 0 && (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(
                { id: "payroll.adjustment.noEmployees" },
                {
                  link: (chunks) => (
                    <Link className="text-primary hover:underline" to="/employees">
                      {chunks}
                    </Link>
                  ),
                },
              )}
            </p>
          )}
          {(formOpen || editing) && (
            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">
                {intl.formatMessage({ id: editing ? "payroll.adjustment.editTitle" : "payroll.adjustment.newTitle" })}
              </p>
              <AdjustmentForm
                key={editing?.id ?? "new"}
                companyId={companyId}
                period={period}
                initial={editing}
                submitting={saveMutation.isPending}
                error={formError}
                onSubmit={(request) => saveMutation.mutate({ id: editing?.id ?? null, request })}
                onCancel={() => {
                  setFormOpen(false);
                  setEditingId(null);
                  setFormError(null);
                }}
              />
            </div>
          )}
          {rowError && (
            <Alert variant="destructive">
              <AlertDescription>{rowError}</AlertDescription>
            </Alert>
          )}
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={adjustments}
            rowCount={adjustments.length}
            isLoading={adjustmentsQuery.isLoading}
            getRowId={(row) => row.id}
            getRowClassName={(row) => (row.payrollRunId ? "text-muted-foreground" : undefined)}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "payroll.adjustment.empty" })}
            exportFileName={`payroll-adjustments-${month}`}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
