import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { PayrollRunDetailResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import {
  formatAmount,
  formatPayrollMonth,
  isValidMonth,
  monthBounds,
  nextUnrunMonth,
  payrollRunStateBadgeVariant,
  payrollRunStateLabel,
} from "@/lib/payroll-enums";
import { PayrollAdjustments } from "@/pages/payroll/PayrollAdjustments";

const RUNS_GRID_ID = "payrollRuns";

type View = "runs" | "adjustments";

function payrollRunsQueryKey(companyId: string | null) {
  return ["payrollRuns", companyId] as const;
}

export function Payroll() {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const [searchParams, setSearchParams] = useSearchParams();

  const view: View = searchParams.get("view") === "adjustments" ? "adjustments" : "runs";
  const monthParam = searchParams.get("month");

  const runsQuery = useQuery({
    queryKey: payrollRunsQueryKey(companyId),
    queryFn: () => apiClient.listPayrollRuns(companyId as string),
    enabled: !!companyId,
  });
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const suggestedMonth = useMemo(() => nextUnrunMonth(runs), [runs]);
  const selectedMonth = isValidMonth(monthParam) ? monthParam : suggestedMonth;

  // The new-run month is a form value, not a filter — it follows the suggestion until edited.
  const [newRunMonth, setNewRunMonth] = useState<string | null>(null);
  const effectiveNewRunMonth = newRunMonth ?? suggestedMonth;
  const [createError, setCreateError] = useState<string | null>(null);

  function setParam(name: string, value: string | null) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value === null) params.delete(name);
        else params.set(name, value);
        return params;
      },
      { replace: true },
    );
  }

  const createRun = useMutation({
    mutationFn: (month: string) => {
      const { start, end } = monthBounds(month);
      return apiClient.createPayrollRun(companyId as string, { periodStart: start, periodEnd: end });
    },
    onSuccess: async (run) => {
      setCreateError(null);
      setNewRunMonth(null);
      await queryClient.invalidateQueries({ queryKey: payrollRunsQueryKey(companyId) });
      navigate(`/payroll/${run.id}`);
    },
    onError: (err: unknown) => setCreateError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.createRunError" }))),
  });

  function handleCreateRun(event: FormEvent) {
    event.preventDefault();
    if (!companyId || !isValidMonth(effectiveNewRunMonth)) return;
    createRun.mutate(effectiveNewRunMonth);
  }

  const columns = useMemo<ColumnDef<PayrollRunDetailResponse>[]>(
    () => [
      {
        id: "period",
        header: intl.formatMessage({ id: "payroll.period" }),
        accessorFn: (row) => row.periodStart,
        cell: ({ row }) => (
          <Link className="font-medium text-primary hover:underline" to={`/payroll/${row.original.id}`}>
            {formatPayrollMonth(row.original.periodStart, intl)}
          </Link>
        ),
      },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "payroll.state" }),
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Badge variant={payrollRunStateBadgeVariant(state)}>{payrollRunStateLabel(state, intl)}</Badge>;
        },
      },
      {
        id: "gross",
        header: intl.formatMessage({ id: "payroll.totals.gross" }),
        meta: { numeric: true },
        accessorFn: (row) => row.totals.gross,
        cell: ({ getValue }) => formatAmount(getValue() as number),
      },
      {
        id: "pit",
        header: intl.formatMessage({ id: "payroll.totals.pit" }),
        meta: { numeric: true },
        accessorFn: (row) => row.totals.pit,
        cell: ({ getValue }) => formatAmount(getValue() as number),
      },
      {
        id: "netPay",
        header: intl.formatMessage({ id: "payroll.totals.netPay" }),
        meta: { numeric: true },
        accessorFn: (row) => row.totals.netPay,
        cell: ({ getValue }) => formatAmount(getValue() as number),
      },
      {
        id: "employerCost",
        header: intl.formatMessage({ id: "payroll.totals.employerCost" }),
        meta: { numeric: true },
        accessorFn: (row) => row.totals.employerCost,
        cell: ({ getValue }) => formatAmount(getValue() as number),
      },
      {
        accessorKey: "paidOn",
        header: intl.formatMessage({ id: "payroll.paidOn" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "—",
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Link className="text-xs font-medium text-primary hover:underline" to={`/payroll/${row.original.id}`}>
            {intl.formatMessage({ id: "common.view" })}
          </Link>
        ),
      },
    ],
    [intl],
  );

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "payroll.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "payroll.screenDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
        </CardContent>
      </Card>
    );
  }

  const loadError = runsQuery.isError ? getApiErrorMessage(runsQuery.error, intl.formatMessage({ id: "payroll.loadError" })) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "payroll.title" })}</h2>
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage(
              { id: "payroll.employeesLiveUnder" },
              {
                link: (chunks) => (
                  <Link className="text-primary hover:underline" to="/employees">
                    {chunks}
                  </Link>
                ),
              },
            )}
          </p>
        </div>
        <div className="flex gap-2" role="tablist">
          {(["runs", "adjustments"] as const).map((key) => (
            <Button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              variant={view === key ? "default" : "outline"}
              size="sm"
              onClick={() => setParam("view", key === "runs" ? null : key)}
            >
              {intl.formatMessage({ id: key === "runs" ? "payroll.payrollRuns" : "payroll.adjustments.tab" })}
            </Button>
          ))}
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {view === "runs" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{intl.formatMessage({ id: "payroll.newPayrollRun" })}</CardTitle>
              <CardDescription>{intl.formatMessage({ id: "payroll.newRunHint" })}</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCreateRun}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="payroll-new-run-month">{intl.formatMessage({ id: "payroll.month" })}</Label>
                  <Input
                    id="payroll-new-run-month"
                    type="month"
                    className="w-44"
                    value={effectiveNewRunMonth}
                    onChange={(event) => setNewRunMonth(event.target.value)}
                    required
                  />
                </div>
                <Button type="submit" size="sm" disabled={createRun.isPending || !isValidMonth(effectiveNewRunMonth)}>
                  {createRun.isPending
                    ? intl.formatMessage({ id: "payroll.creatingRun" })
                    : intl.formatMessage({ id: "payroll.createPayrollRun" })}
                </Button>
                {isValidMonth(effectiveNewRunMonth) && (
                  <span className="text-xs text-muted-foreground sm:pb-2">
                    {(() => {
                      const { start, end } = monthBounds(effectiveNewRunMonth);
                      return `${start} – ${end}`;
                    })()}
                  </span>
                )}
              </form>
              {createError && (
                <Alert variant="destructive" className="mt-3">
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{intl.formatMessage({ id: "payroll.payrollRuns" })}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataGrid
                gridId={RUNS_GRID_ID}
                columns={columns}
                data={runs}
                rowCount={runs.length}
                isLoading={runsQuery.isLoading}
                getRowId={(row) => row.id}
                getRowClassName={(row) => (row.state === "Draft" ? "text-muted-foreground" : undefined)}
                emptyMessage={intl.formatMessage({ id: "payroll.noPayrollRuns" })}
                exportFileName="payroll-runs"
                manualFiltering={false}
                manualSorting={false}
                manualGrouping={false}
                defaultPageSize={100}
                pageSizeOptions={[50, 100, 200]}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <PayrollAdjustments
          companyId={activeCompany.id}
          month={selectedMonth}
          onMonthChange={(month) => setParam("month", month)}
        />
      )}
    </div>
  );
}
