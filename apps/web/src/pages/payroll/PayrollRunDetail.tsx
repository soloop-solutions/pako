import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Download, FileDown, Printer } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { PayrollRunDetailResponse, PayslipDetailResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useTabMeta } from "@/context/TabsContext";
import {
  formatAmount,
  formatPayrollMonth,
  payrollRunStateBadgeVariant,
  payrollRunStateLabel,
  payrollWarningMessage,
  type PayrollRunAction,
} from "@/lib/payroll-enums";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";
import { PayrollRunActions } from "@/pages/payroll/PayrollRunActions";
import { downloadFileResponse } from "@/lib/download";
import { Payslip, PayslipPrintPortal } from "@/pages/payroll/Payslip";
import { useMyAccess } from "@/hooks/useMyAccess";

const PAYSLIPS_GRID_ID = "payslips";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function TotalTile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border px-3 py-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={strong ? "text-base font-semibold tabular-nums" : "text-sm font-medium tabular-nums"}>{value}</span>
    </div>
  );
}

export function PayrollRunDetail() {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const companyId = activeCompany?.id ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPayslipId = searchParams.get("payslip");

  const [busyAction, setBusyAction] = useState<PayrollRunAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(todayIso);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [exporting, setExporting] = useState<"register" | "edi" | "zip" | null>(null);
  const [printTarget, setPrintTarget] = useState<"all" | string | null>(null);

  const runKey = ["payrollRun", companyId, id] as const;
  const runQuery = useQuery({
    queryKey: runKey,
    queryFn: () => apiClient.getPayrollRun(companyId as string, id as string),
    enabled: !!companyId && !!id,
  });
  const run = runQuery.data ?? null;

  const paymentMethodsQuery = useQuery({
    queryKey: ["paymentMethods", companyId],
    queryFn: () => apiClient.paymentMethodsAll(companyId as string),
    enabled: !!companyId && payOpen,
  });
  const paymentMethods = useMemo(() => paymentMethodsQuery.data ?? [], [paymentMethodsQuery.data]);
  const effectivePaymentMethodId = paymentMethodId || paymentMethods[0]?.id || "";

  useTabMeta({ title: run ? `${intl.formatMessage({ id: "payrollRunDetail.title" })} ${formatPayrollMonth(run.periodStart, intl)}` : undefined });

  async function applyRun(result: PayrollRunDetailResponse) {
    queryClient.setQueryData(runKey, result);
    await queryClient.invalidateQueries({ queryKey: ["payrollRuns", companyId] });
  }

  const actionMutation = useMutation({
    mutationFn: async (vars: { action: Exclude<PayrollRunAction, "delete" | "pay"> }) => {
      const cid = companyId as string;
      const rid = id as string;
      switch (vars.action) {
        case "recompute":
          return apiClient.recomputePayrollRun(cid, rid);
        case "approve":
          return apiClient.approvePayrollRun(cid, rid);
        case "returnToDraft":
          return apiClient.returnPayrollRunToDraft(cid, rid);
        case "post":
          return apiClient.postPayrollRun(cid, rid);
      }
    },
    onMutate: (vars) => {
      setBusyAction(vars.action);
      setActionError(null);
    },
    onSuccess: async (result, vars) => {
      if (vars.action === "approve") toast.success(intl.formatMessage({ id: "toast.payrollRunApproved" }));
      if (vars.action === "post") toast.success(intl.formatMessage({ id: "toast.payrollRunPosted" }));
      await applyRun(result);
    },
    onError: (err: unknown, vars) =>
      setActionError(getApiErrorMessage(err, intl.formatMessage({ id: `payroll.action.${vars.action}Error` }))),
    onSettled: () => setBusyAction(null),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deletePayrollRun(companyId as string, id as string),
    onMutate: () => {
      setBusyAction("delete");
      setActionError(null);
    },
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "toast.payrollRunDeleted" }));
      queryClient.removeQueries({ queryKey: runKey });
      await queryClient.invalidateQueries({ queryKey: ["payrollRuns", companyId] });
      navigate("/payroll");
    },
    onError: (err: unknown) => setActionError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.action.deleteError" }))),
    onSettled: () => setBusyAction(null),
  });

  const payMutation = useMutation({
    mutationFn: (body: { paidOn: string; cashOrBankAccountId: string }) => apiClient.payPayrollRun(companyId as string, id as string, body),
    onMutate: () => {
      setBusyAction("pay");
      setActionError(null);
    },
    onSuccess: async (result) => {
      toast.success(intl.formatMessage({ id: "toast.payrollRunPaid" }));
      setPayOpen(false);
      await applyRun(result);
    },
    onError: (err: unknown) => setActionError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.action.payError" }))),
    onSettled: () => setBusyAction(null),
  });

  function handleAction(action: PayrollRunAction) {
    if (!run) return;
    const month = formatPayrollMonth(run.periodStart, intl);
    switch (action) {
      case "delete":
        if (window.confirm(intl.formatMessage({ id: "payroll.action.confirmDelete" }, { month }))) deleteMutation.mutate();
        return;
      case "post":
        if (window.confirm(intl.formatMessage({ id: "payroll.action.confirmPost" }, { month }))) actionMutation.mutate({ action });
        return;
      case "pay":
        setPayOpen(true);
        setActionError(null);
        return;
      default:
        actionMutation.mutate({ action });
    }
  }

  function handlePay(event: FormEvent) {
    event.preventDefault();
    const method = paymentMethods.find((m) => m.id === effectivePaymentMethodId);
    if (!method) {
      setActionError(intl.formatMessage({ id: "recordPayment.accountError" }));
      return;
    }
    payMutation.mutate({ paidOn, cashOrBankAccountId: method.ledgerAccountId });
  }

  async function downloadPayslipPdf(line: PayslipDetailResponse) {
    if (!companyId || !id || !run) return;
    setActionError(null);
    try {
      downloadFileResponse(await apiClient.payslipPdf(companyId, id, line.id), `payslip-${run.periodStart.slice(0, 7)}.pdf`);
    } catch (err) {
      setActionError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.exportError" })));
    }
  }

  async function handleExport(kind: "register" | "edi" | "zip") {
    if (!companyId || !id || !run) return;
    setExporting(kind);
    setActionError(null);
    try {
      const month = run.periodStart.slice(0, 7);
      if (kind === "zip") {
        downloadFileResponse(await apiClient.payslipsZip(companyId, id), `payslips-${month}.zip`);
        return;
      }
      const file = kind === "register" ? await apiClient.payrollRegisterExport(companyId, id) : await apiClient.payrollEdiExport(companyId, id);
      downloadFileResponse(file, kind === "register" ? `payroll-register-${month}.xlsx` : `payroll-edi-${month}.xlsx`);
    } catch (err) {
      setActionError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.exportError" })));
    } finally {
      setExporting(null);
    }
  }

  // Mount the print-only payslips synchronously, print, and unmount once the dialog closes.
  function printPayslips(target: "all" | string) {
    flushSync(() => setPrintTarget(target));
    window.addEventListener("afterprint", () => setPrintTarget(null), { once: true });
    window.print();
  }

  function selectPayslip(lineId: string | null) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (lineId) params.set("payslip", lineId);
        else params.delete("payslip");
        return params;
      },
      { replace: true },
    );
  }

  const money = (value: number) => formatAmount(value);

  const columns = useMemo<ColumnDef<PayslipDetailResponse>[]>(() => {
    const amountColumn = (key: keyof PayslipDetailResponse & string, labelId: string): ColumnDef<PayslipDetailResponse> => ({
      accessorKey: key,
      header: intl.formatMessage({ id: labelId }),
      meta: { numeric: true },
      enableColumnFilter: false,
      cell: ({ getValue }) => formatAmount(getValue() as number),
    });
    return [
      {
        accessorKey: "employeeName",
        header: intl.formatMessage({ id: "payrollRunDetail.employee" }),
        cell: ({ row }) => (
          <button
            type="button"
            className="text-left font-medium text-primary hover:underline"
            onClick={() => selectPayslip(row.original.id)}
          >
            {row.original.employeeName}
          </button>
        ),
      },
      {
        accessorKey: "personalNumber",
        header: intl.formatMessage({ id: "payroll.payslip.personalNumber" }),
        cell: ({ getValue }) => (getValue() as string | undefined) || "\u2014",
      },
      {
        accessorKey: "departmentName",
        header: intl.formatMessage({ id: "payroll.payslip.department" }),
        enableGrouping: true,
        meta: { groupable: true },
        cell: ({ getValue }) => (getValue() as string | undefined) || "\u2014",
      },
      {
        accessorKey: "costCenterName",
        header: intl.formatMessage({ id: "payroll.payslip.costCenter" }),
        enableGrouping: true,
        meta: { groupable: true },
        cell: ({ getValue }) => (getValue() as string | undefined) || "\u2014",
      },
      amountColumn("baseSalary", "payroll.payslip.baseSalary"),
      {
        id: "days",
        header: intl.formatMessage({ id: "payroll.payslip.days" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        accessorFn: (row) => row.paidDays,
        cell: ({ row }) => `${row.original.paidDays}/${row.original.workingDays}`,
      },
      amountColumn("bonusAmount", "payroll.payslip.bonuses"),
      amountColumn("otherAdditionsAmount", "payroll.payslip.otherAdditions"),
      amountColumn("grossSalary", "payrollRunDetail.grossSalary"),
      amountColumn("employeePensionAmount", "payrollRunDetail.employeePension"),
      amountColumn("pitAmount", "payrollRunDetail.pit"),
      amountColumn("deductionsAmount", "payroll.payslip.deductions"),
      {
        accessorKey: "netPay",
        header: intl.formatMessage({ id: "payrollRunDetail.netPay" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        cell: ({ getValue }) => {
          const value = getValue() as number;
          return <span className={value < 0 ? "font-semibold text-destructive" : "font-semibold"}>{formatAmount(value)}</span>;
        },
      },
      amountColumn("employerPensionAmount", "payrollRunDetail.employerPension"),
      {
        id: "employerType",
        header: intl.formatMessage({ id: "payroll.payslip.employerType" }),
        accessorFn: (row) =>
          intl.formatMessage({ id: row.isPrimaryEmployer ? "payroll.payslip.primaryShort" : "payroll.payslip.secondaryShort" }),
        cell: ({ row, getValue }) => <Badge variant={row.original.isPrimaryEmployer ? "outline" : "warning"}>{getValue() as string}</Badge>,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button
              size="xs"
              variant="ghost"
              className="h-6"
              aria-label={intl.formatMessage({ id: "payroll.payslip.downloadOne" }, { name: row.original.employeeName })}
              onClick={() => void downloadPayslipPdf(row.original)}
            >
              <FileDown className="size-3.5" />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="h-6"
              aria-label={intl.formatMessage({ id: "payroll.payslip.printOne" }, { name: row.original.employeeName })}
              onClick={() => printPayslips(row.original.id)}
            >
              <Printer className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intl, companyId, id, run?.periodStart]);

  if (!activeCompany || !run) {
    const loadError = runQuery.isError ? getApiErrorMessage(runQuery.error, intl.formatMessage({ id: "payrollRunDetail.loadError" })) : null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "payrollRunDetail.title" })}</CardTitle>
        </CardHeader>
        <CardContent>
          {!activeCompany ? (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
          ) : loadError ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const selectedLine = selectedPayslipId ? run.lines.find((l) => l.id === selectedPayslipId) ?? null : null;
  const printLines = printTarget === null ? [] : printTarget === "all" ? run.lines : run.lines.filter((l) => l.id === printTarget);
  const totals = run.totals;

  return (
    <div className="flex flex-col gap-4">
      <Link className="text-sm text-muted-foreground hover:underline" to="/payroll">
        &larr; {intl.formatMessage({ id: "payrollRunDetail.backToPayroll" })}
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">{formatPayrollMonth(run.periodStart, intl)}</CardTitle>
                <Badge variant={payrollRunStateBadgeVariant(run.state)}>{payrollRunStateLabel(run.state, intl)}</Badge>
              </div>
              <CardDescription>
                {intl.formatMessage({ id: "payrollRunDetail.title" })} · {run.periodStart} \u2013 {run.periodEnd}
              </CardDescription>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {run.approvedAt && (
                  <span>{intl.formatMessage({ id: "payroll.approvedAt" }, { date: run.approvedAt.slice(0, 10) })}</span>
                )}
                {run.journalEntryId && (
                  <span>
                    {intl.formatMessage({ id: "payroll.accrualEntry" })}{" "}
                    <Link className="font-mono text-primary hover:underline" to="/ledger" title={run.journalEntryId}>
                      {run.journalEntryId.slice(0, 8)}
                    </Link>
                  </span>
                )}
                {run.paidOn && <span>{intl.formatMessage({ id: "payroll.paidOnDate" }, { date: run.paidOn })}</span>}
                {run.paymentJournalEntryId && (
                  <span>
                    {intl.formatMessage({ id: "payroll.paymentEntry" })}{" "}
                    <Link className="font-mono text-primary hover:underline" to="/ledger" title={run.paymentJournalEntryId}>
                      {run.paymentJournalEntryId.slice(0, 8)}
                    </Link>
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <PayrollRunActions
                state={run.state}
                busyAction={busyAction}
                onAction={handleAction}
                canEdit={canWrite("payroll")}
                canApprove={canApprove("payroll")}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="xs" variant="outline" disabled={exporting !== null} onClick={() => void handleExport("register")}>
                  <Download className="size-3.5" />
                  {intl.formatMessage({ id: exporting === "register" ? "reports.exportingReport" : "payroll.exportRegister" })}
                </Button>
                <Button type="button" size="xs" variant="outline" disabled={exporting !== null} onClick={() => void handleExport("edi")}>
                  <Download className="size-3.5" />
                  {intl.formatMessage({ id: exporting === "edi" ? "reports.exportingReport" : "payroll.exportEdi" })}
                </Button>
                <Button type="button" size="xs" variant="outline" disabled={exporting !== null || run.lines.length === 0} onClick={() => void handleExport("zip")}>
                  <FileDown className="size-3.5" />
                  {intl.formatMessage({ id: exporting === "zip" ? "reports.exportingReport" : "payroll.payslip.downloadAll" })}
                </Button>
                <Button type="button" size="xs" variant="outline" disabled={run.lines.length === 0} onClick={() => printPayslips("all")}>
                  <Printer className="size-3.5" />
                  {intl.formatMessage({ id: "payroll.payslip.printAll" })}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {actionError && (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}

          {payOpen && run.state === "Posted" && (
            <form className="flex flex-col gap-3 rounded-md border p-3" onSubmit={handlePay} aria-label={intl.formatMessage({ id: "payroll.pay.title" })}>
              <div>
                <p className="text-sm font-medium">{intl.formatMessage({ id: "payroll.pay.title" })}</p>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: "payroll.pay.description" }, { amount: money(totals.netPay) })}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="payroll-paid-on">{intl.formatMessage({ id: "payroll.pay.date" })}</Label>
                  <Input id="payroll-paid-on" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="payroll-pay-account">{intl.formatMessage({ id: "recordPayment.cashBankAccount" })}</Label>
                  <PaymentMethodSelect
                    id="payroll-pay-account"
                    paymentMethods={paymentMethods}
                    value={effectivePaymentMethodId}
                    onChange={setPaymentMethodId}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button type="submit" size="sm" disabled={busyAction !== null || paymentMethods.length === 0}>
                    {intl.formatMessage({ id: busyAction === "pay" ? "payroll.action.paying" : "payroll.pay.confirm" })}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setPayOpen(false)} disabled={busyAction !== null}>
                    {intl.formatMessage({ id: "common.cancel" })}
                  </Button>
                </div>
              </div>
            </form>
          )}

          {run.warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="size-4 text-amber-600" />
              <AlertDescription>
                <p className="font-medium text-foreground">{intl.formatMessage({ id: "payroll.warnings.title" }, { count: run.warnings.length })}</p>
                <ul className="list-disc pl-4">
                  {run.warnings.map((warning) => (
                    <li key={warning}>{payrollWarningMessage(warning, intl)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <TotalTile label={intl.formatMessage({ id: "payroll.totals.gross" })} value={money(totals.gross)} />
            <TotalTile label={intl.formatMessage({ id: "payroll.totals.employeePension" })} value={money(totals.employeePension)} />
            <TotalTile label={intl.formatMessage({ id: "payroll.totals.pit" })} value={money(totals.pit)} />
            <TotalTile label={intl.formatMessage({ id: "payroll.totals.deductions" })} value={money(totals.deductions)} />
            <TotalTile label={intl.formatMessage({ id: "payroll.totals.netPay" })} value={money(totals.netPay)} strong />
            <TotalTile label={intl.formatMessage({ id: "payroll.totals.employerPension" })} value={money(totals.employerPension)} />
            <TotalTile label={intl.formatMessage({ id: "payroll.totals.employerCost" })} value={money(totals.employerCost)} strong />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "payroll.payslips" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "payroll.payslipsHint" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={PAYSLIPS_GRID_ID}
            columns={columns}
            data={run.lines}
            rowCount={run.lines.length}
            getRowId={(row) => row.id}
            getRowClassName={(row) => (row.id === selectedPayslipId ? "bg-row-selected" : undefined)}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "payrollRunDetail.noPayslipLines" })}
            exportFileName={`payslips-${run.periodStart.slice(0, 7)}`}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
        </CardContent>
      </Card>

      {selectedLine && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{intl.formatMessage({ id: "payroll.payslip.titleFor" }, { name: selectedLine.employeeName })}</CardTitle>
              <div className="flex gap-2">
                <Button type="button" size="xs" variant="outline" onClick={() => printPayslips(selectedLine.id)}>
                  <Printer className="size-3.5" />
                  {intl.formatMessage({ id: "payroll.payslip.print" })}
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => selectPayslip(null)}>
                  {intl.formatMessage({ id: "payroll.payslip.close" })}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Payslip
              className="mx-auto max-w-2xl"
              companyName={activeCompany.name}
              periodStart={run.periodStart}
              periodEnd={run.periodEnd}
              line={selectedLine}
            />
          </CardContent>
        </Card>
      )}

      {printLines.length > 0 && (
        <PayslipPrintPortal companyName={activeCompany.name} periodStart={run.periodStart} periodEnd={run.periodEnd} lines={printLines} />
      )}
    </div>
  );
}
