import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, FileDown } from "lucide-react";
import type { MyPayslipResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCompany } from "@/context/CompanyContext";
import { downloadFileResponse } from "@/lib/download";
import { formatAmount, formatPayrollMonth } from "@/lib/payroll-enums";
import { EmployeeAnnualStatement } from "@/pages/hr/EmployeeAnnualStatement";
import { Payslip } from "@/pages/payroll/Payslip";

// F9: my posted payslips (Draft/Approved runs never appear) and my annual statement. Every amount
// is rendered as the API returns it.
export function MyPayslips() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const [viewing, setViewing] = useState<MyPayslipResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payslipsQuery = useQuery({
    queryKey: ["me", "payslips", companyId],
    queryFn: () => apiClient.listMyPayslips(companyId as string),
    enabled: !!companyId,
  });

  const detailQuery = useQuery({
    queryKey: ["me", "payslip", companyId, viewing?.lineId],
    queryFn: () => apiClient.getMyPayslip(companyId as string, viewing!.lineId),
    enabled: !!companyId && !!viewing,
  });

  async function download(row: MyPayslipResponse) {
    if (!companyId) return;
    setError(null);
    try {
      downloadFileResponse(await apiClient.myPayslipPdf(companyId, row.lineId), `payslip-${row.periodStart.slice(0, 7)}.pdf`);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "me.payslips.downloadError" })));
    }
  }

  const columns = useMemo<ColumnDef<MyPayslipResponse>[]>(
    () => [
      {
        accessorKey: "periodStart",
        header: intl.formatMessage({ id: "me.payslips.month" }),
        cell: ({ getValue }) => formatPayrollMonth(getValue() as string, intl),
      },
      {
        accessorKey: "grossSalary",
        header: intl.formatMessage({ id: "payroll.payslip.gross" }),
        meta: { numeric: true },
        cell: ({ getValue }) => formatAmount(getValue() as number),
      },
      {
        accessorKey: "netPay",
        header: intl.formatMessage({ id: "payroll.payslip.netPay" }),
        meta: { numeric: true },
        cell: ({ getValue }) => <span className="font-medium">{formatAmount(getValue() as number)}</span>,
      },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "me.payslips.status" }),
        cell: ({ row }) => (
          <Badge variant={row.original.state === "Paid" ? "secondary" : "outline"}>
            {row.original.state === "Paid"
              ? intl.formatMessage({ id: "me.payslips.paidOn" }, { date: row.original.paidOn ?? "" })
              : intl.formatMessage({ id: "me.payslips.posted" })}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" aria-label={intl.formatMessage({ id: "me.payslips.view" })} onClick={() => setViewing(row.original)}>
              <Eye className="size-3.5" />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              aria-label={intl.formatMessage({ id: "me.payslips.download" })}
              onClick={() => void download(row.original)}
            >
              <FileDown className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, companyId],
  );

  if (!companyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const rows = payslipsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "me.payslips.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "me.payslips.description" })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(error || payslipsQuery.isError) && (
            <Alert variant="destructive">
              <AlertDescription>
                {error ?? getApiErrorMessage(payslipsQuery.error, intl.formatMessage({ id: "me.loadError" }))}
              </AlertDescription>
            </Alert>
          )}
          <DataGrid
            gridId="my-payslips"
            columns={columns}
            data={rows}
            rowCount={rows.length}
            isLoading={payslipsQuery.isPending}
            getRowId={(row) => row.lineId}
            onRowClick={(row) => setViewing(row)}
            emptyMessage={intl.formatMessage({ id: "me.payslips.empty" })}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "me.statement.title" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmployeeAnnualStatement companyId={companyId} />
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>{viewing ? formatPayrollMonth(viewing.periodStart, intl) : ""}</DialogTitle>
          {detailQuery.data && viewing && (
            <Payslip companyName={activeCompany?.name ?? ""} periodStart={viewing.periodStart} periodEnd={viewing.periodEnd} line={detailQuery.data} />
          )}
          {detailQuery.isPending && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
