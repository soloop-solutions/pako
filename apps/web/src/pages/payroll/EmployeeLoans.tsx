import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { EmployeeLoanResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { EmployeePicker } from "@/components/EmployeePicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { formatAmount, formatPayrollMonth } from "@/lib/payroll-enums";
import { cn } from "@/lib/utils";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";

// Mirrors EmployeeLoanKind (numeric on the wire).
const LoanKind = { Advance: 0, Loan: 1 } as const;

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const stateVariant: Record<string, "default" | "secondary" | "outline"> = { Active: "default", Settled: "secondary", Cancelled: "outline" };

// G10: salary advances and loans — issued here (posted straight to cash/bank), recovered by
// payroll in installments. Every amount, outstanding included, is the API's.
export function EmployeeLoansPanel({ companyId, employeeId }: { companyId: string; employeeId?: string }) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { canApprove } = useMyAccess();
  const queryKey = ["employeeLoans", companyId, employeeId ?? "all"] as const;

  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formEmployeeId, setFormEmployeeId] = useState(employeeId ?? "");
  const [kind, setKind] = useState<number>(LoanKind.Advance);
  const [principal, setPrincipal] = useState("");
  const [installment, setInstallment] = useState("");
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [firstMonth, setFirstMonth] = useState(todayIso().slice(0, 7));
  const [notes, setNotes] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");

  const loansQuery = useQuery({ queryKey, queryFn: () => apiClient.listEmployeeLoans(companyId, employeeId, undefined) });
  const paymentMethodsQuery = useQuery({
    queryKey: ["paymentMethods", companyId],
    queryFn: () => apiClient.paymentMethodsAll(companyId),
    enabled: formOpen,
  });
  const paymentMethods = paymentMethodsQuery.data ?? [];
  const effectiveMethodId = paymentMethodId || paymentMethods[0]?.id || "";

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["employeeLoans", companyId] });

  const createMutation = useMutation({
    mutationFn: () => {
      const method = paymentMethods.find((m) => m.id === effectiveMethodId);
      return apiClient.createEmployeeLoan(companyId, {
        employeeId: formEmployeeId,
        kind,
        principal: Number(principal.replace(",", ".")),
        installmentAmount: Number(installment.replace(",", ".")),
        issuedOn,
        firstPeriod: `${firstMonth}-01`,
        cashOrBankAccountId: method?.ledgerAccountId ?? "",
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      setError(null);
      setFormOpen(false);
      setPrincipal("");
      setInstallment("");
      setNotes("");
      refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "loans.saveError" }))),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.cancelEmployeeLoan(companyId, id, undefined),
    onSuccess: refresh,
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "loans.cancelError" }))),
  });

  const columns = useMemo<ColumnDef<EmployeeLoanResponse>[]>(
    () => [
      ...(employeeId ? [] : [{ accessorKey: "employeeName", header: intl.formatMessage({ id: "me.leave.employee" }), meta: { groupable: true } } as ColumnDef<EmployeeLoanResponse>]),
      {
        accessorKey: "kind",
        header: intl.formatMessage({ id: "loans.kind" }),
        cell: ({ getValue }) => intl.formatMessage({ id: getValue() === LoanKind.Loan ? "loans.kind.loan" : "loans.kind.advance" }),
      },
      { accessorKey: "issuedOn", header: intl.formatMessage({ id: "loans.issuedOn" }) },
      { accessorKey: "principal", header: intl.formatMessage({ id: "loans.principal" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "installmentAmount", header: intl.formatMessage({ id: "loans.installment" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "firstPeriod", header: intl.formatMessage({ id: "loans.firstMonth" }), cell: ({ getValue }) => formatPayrollMonth(getValue() as string, intl) },
      { accessorKey: "repaidPosted", header: intl.formatMessage({ id: "loans.repaid" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      {
        accessorKey: "outstanding",
        header: intl.formatMessage({ id: "loans.outstanding" }),
        meta: { numeric: true },
        cell: ({ row }) => (
          <span className="font-medium" title={row.original.inDraftRuns > 0 ? intl.formatMessage({ id: "loans.inDraft" }, { amount: formatAmount(row.original.inDraftRuns) }) : undefined}>
            {formatAmount(row.original.outstanding)}
          </span>
        ),
      },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "me.payslips.status" }),
        cell: ({ getValue }) => (
          <Badge variant={stateVariant[getValue() as string] ?? "outline"} className={cn(getValue() === "Cancelled" && "line-through")}>
            {intl.formatMessage({ id: `loans.state.${getValue() as string}` })}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canApprove("payroll") && row.original.state === "Active" && row.original.repaidPosted === 0 && row.original.inDraftRuns === 0 ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={cancelMutation.isPending}
              onClick={() => {
                if (window.confirm(intl.formatMessage({ id: "loans.cancelConfirm" }))) cancelMutation.mutate(row.original.id);
              }}
            >
              {intl.formatMessage({ id: "me.leave.cancel" })}
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, employeeId, cancelMutation.isPending],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!formEmployeeId || !principal || !installment || !issuedOn || !firstMonth || !effectiveMethodId) {
      setError(intl.formatMessage({ id: "loans.missingFields" }));
      return;
    }
    createMutation.mutate();
  }

  const loans = loansQuery.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "loans.hint" })}</p>
        {canApprove("payroll") && (
          <Button size="sm" variant="outline" onClick={() => setFormOpen((open) => !open)}>
            {intl.formatMessage({ id: "loans.new" })}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {formOpen && (
        <form className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-4" onSubmit={handleSubmit} aria-label={intl.formatMessage({ id: "loans.new" })}>
          {!employeeId && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="loan-employee">{intl.formatMessage({ id: "me.leave.employee" })}</Label>
              <EmployeePicker companyId={companyId} id="loan-employee" value={formEmployeeId} onChange={(id) => setFormEmployeeId(id ?? "")} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="loan-kind">{intl.formatMessage({ id: "loans.kind" })}</Label>
            <Select
              id="loan-kind"
              value={String(kind)}
              onValueChange={(v) => setKind(Number(v))}
              options={[
                { value: String(LoanKind.Advance), label: intl.formatMessage({ id: "loans.kind.advance" }) },
                { value: String(LoanKind.Loan), label: intl.formatMessage({ id: "loans.kind.loan" }) },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="loan-principal">{intl.formatMessage({ id: "loans.principal" })}</Label>
            <Input id="loan-principal" inputMode="decimal" className="text-right tabular-nums" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="loan-installment">{intl.formatMessage({ id: "loans.installment" })}</Label>
            <Input id="loan-installment" inputMode="decimal" className="text-right tabular-nums" value={installment} onChange={(e) => setInstallment(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="loan-issued">{intl.formatMessage({ id: "loans.issuedOn" })}</Label>
            <Input id="loan-issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="loan-first">{intl.formatMessage({ id: "loans.firstMonth" })}</Label>
            <Input id="loan-first" type="month" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="loan-account">{intl.formatMessage({ id: "recordPayment.cashBankAccount" })}</Label>
            <PaymentMethodSelect id="loan-account" paymentMethods={paymentMethods} value={effectiveMethodId} onChange={setPaymentMethodId} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="loan-notes">{intl.formatMessage({ id: "hr.contract.notes" })}</Label>
            <Input id="loan-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {intl.formatMessage({ id: "loans.issue" })}
            </Button>
            <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "loans.issueHint" })}</span>
          </div>
        </form>
      )}

      <DataGrid
        gridId={employeeId ? "employee-loans-one" : "employee-loans"}
        columns={columns}
        data={loans}
        rowCount={loans.length}
        isLoading={loansQuery.isPending}
        getRowId={(row) => row.id}
        getRowClassName={(row) => (row.state === "Active" ? undefined : "text-muted-foreground")}
        emptyMessage={intl.formatMessage({ id: "loans.empty" })}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
      />
    </div>
  );
}

export function EmployeeLoans() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  if (!activeCompanyId) return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "nav.employeeLoans" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "nav.employeeLoans.description" })}</CardDescription>
      </CardHeader>
      <CardContent>
        <EmployeeLoansPanel companyId={activeCompanyId} />
      </CardContent>
    </Card>
  );
}
