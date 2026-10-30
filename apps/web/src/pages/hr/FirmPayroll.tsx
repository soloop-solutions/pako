import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { FirmPayrollCompanyResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { formatAmount, formatPayrollMonth } from "@/lib/payroll-enums";
import { cn } from "@/lib/utils";

const statusVariant: Record<string, "success" | "destructive" | "warning" | "outline"> = {
  Done: "success",
  Overdue: "destructive",
  DueSoon: "warning",
  Open: "outline",
};

function lastMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// I14: one payroll month across every client of the active company's firm — red when the EDI
// deadline has passed unposted, amber when it is within five days. A row opens that client's
// payroll.
export function FirmPayroll() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { activeCompany, activeCompanyId } = useCompany();
  const firmId = activeCompany?.firmId ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") ?? lastMonth();

  const overviewQuery = useQuery({
    queryKey: ["firmPayroll", firmId, month],
    queryFn: () => apiClient.getFirmPayrollOverview(firmId as string, `${month}-01`),
    enabled: !!firmId,
  });

  const columns = useMemo<ColumnDef<FirmPayrollCompanyResponse>[]>(
    () => [
      { accessorKey: "companyName", header: intl.formatMessage({ id: "firmPayroll.company" }) },
      { accessorKey: "employeeCount", header: intl.formatMessage({ id: "commission.plan.employees" }), meta: { numeric: true } },
      {
        accessorKey: "runState",
        header: intl.formatMessage({ id: "firmPayroll.run" }),
        cell: ({ getValue }) => {
          const state = getValue() as string | undefined;
          return state ? intl.formatMessage({ id: `payroll.state.${state.toLowerCase()}` }) : intl.formatMessage({ id: "firmPayroll.noRun" });
        },
      },
      {
        accessorKey: "totalGross",
        header: intl.formatMessage({ id: "payroll.payslip.gross" }),
        meta: { numeric: true },
        cell: ({ getValue }) => (getValue() == null ? "—" : formatAmount(getValue() as number)),
      },
      {
        accessorKey: "ediDueDate",
        header: intl.formatMessage({ id: "firmPayroll.ediDue" }),
        cell: ({ getValue }) => {
          const due = getValue() as string | undefined;
          return due ? intl.formatDate(new Date(`${due}T00:00`), { dateStyle: "medium" }) : "—";
        },
      },
      {
        accessorKey: "daysRemaining",
        header: intl.formatMessage({ id: "firmPayroll.daysLeft" }),
        meta: { numeric: true },
        cell: ({ row }) => (row.original.status === "Done" ? "—" : row.original.daysRemaining),
      },
      {
        accessorKey: "status",
        header: intl.formatMessage({ id: "me.payslips.status" }),
        cell: ({ getValue }) => <Badge variant={statusVariant[getValue() as string] ?? "outline"}>{intl.formatMessage({ id: `firmPayroll.status.${getValue() as string}` })}</Badge>,
      },
    ],
    [intl],
  );

  if (!firmId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "firmPayroll.noFirm" })}</p>;
  }

  const rows = overviewQuery.data?.companies ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <CardTitle>
              {intl.formatMessage({ id: "nav.firmPayroll" })} · {overviewQuery.data?.firmName ?? ""}
            </CardTitle>
            <CardDescription>{intl.formatMessage({ id: "firmPayroll.description" }, { month: formatPayrollMonth(month, intl) })}</CardDescription>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="firm-payroll-month">{intl.formatMessage({ id: "payroll.month" })}</Label>
            <Input id="firm-payroll-month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("month", e.target.value); return next; }, { replace: true })} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {overviewQuery.isError && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(overviewQuery.error, intl.formatMessage({ id: "firmPayroll.loadError" }))}</AlertDescription>
          </Alert>
        )}
        <DataGrid
          gridId="firm-payroll"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={overviewQuery.isPending}
          getRowId={(row) => row.companyId}
          // Only the open company's row opens its payroll (companies change in the company list), so
          // the other rows don't pretend to be clickable.
          getRowClassName={(row) => cn(row.status === "Overdue" && "bg-destructive/5", row.companyId !== activeCompanyId && "cursor-default!")}
          // The company changes only in the lobby, so only the current company's row opens its payroll.
          onRowClick={(row) => {
            if (row.companyId === activeCompanyId) navigate(row.runId ? `/payroll/${row.runId}` : "/payroll");
          }}
          emptyMessage={intl.formatMessage({ id: "firmPayroll.empty" })}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}
