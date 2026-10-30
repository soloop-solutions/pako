import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { Link, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { ExpenseClaimResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { downloadFileResponse } from "@/lib/download";
import { formatAmount } from "@/lib/payroll-enums";
import { ExpenseStageBadge } from "@/pages/me/ExpenseStageBadge";

const STATES = ["Submitted", "Approved", "Rejected", "Cancelled"] as const;

// H13 (HR): every submitted claim. Approving drafts the purchase bill (posted from Purchases);
// a posted one can be repaid with a month's salary instead of a bank payment.
export function ExpenseClaims() {
  const intl = useIntl();
  const { activeCompanyId: companyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = searchParams.get("state") ?? "Submitted";
  const [selected, setSelected] = useState<ExpenseClaimResponse | null>(null);
  const [note, setNote] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);

  const claimsQuery = useQuery({
    queryKey: ["expenseClaims", companyId, state],
    queryFn: () => apiClient.listExpenseClaims(companyId as string, state === "All" ? undefined : state, undefined),
    enabled: !!companyId,
  });

  const after = (claim: ExpenseClaimResponse) => {
    setError(null);
    setSelected(claim);
    setNote("");
    void queryClient.invalidateQueries({ queryKey: ["expenseClaims", companyId] });
  };

  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      approve
        ? apiClient.approveExpenseClaim(companyId as string, selected!.id, { note: note.trim() || undefined })
        : apiClient.rejectExpenseClaim(companyId as string, selected!.id, { note: note.trim() || undefined }),
    onSuccess: after,
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "expenses.decideError" }))),
  });

  const reimburse = useMutation({
    mutationFn: () => apiClient.reimburseExpenseClaimViaPayroll(companyId as string, selected!.id, { period: `${month}-01` }),
    onSuccess: after,
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "expenses.reimburseError" }))),
  });

  const columns = useMemo<ColumnDef<ExpenseClaimResponse>[]>(
    () => [
      { accessorKey: "employeeName", header: intl.formatMessage({ id: "me.leave.employee" }), meta: { groupable: true } },
      { accessorKey: "title", header: intl.formatMessage({ id: "expenses.title" }) },
      { accessorKey: "submittedAt", header: intl.formatMessage({ id: "expenses.submitted" }), cell: ({ getValue }) => ((getValue() as string | undefined) ?? "").slice(0, 10) },
      { accessorKey: "total", header: intl.formatMessage({ id: "expenses.total" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "outstanding", header: intl.formatMessage({ id: "loans.outstanding" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "stage", header: intl.formatMessage({ id: "me.payslips.status" }), cell: ({ getValue }) => <ExpenseStageBadge stage={getValue() as string} /> },
    ],
    [intl],
  );

  if (!companyId) return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  const claims = claimsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <CardTitle>{intl.formatMessage({ id: "nav.expenseClaims" })}</CardTitle>
              <CardDescription>{intl.formatMessage({ id: "nav.expenseClaims.description" })}</CardDescription>
            </div>
            <div role="tablist" className="flex gap-1 rounded-md border p-0.5">
              {[...STATES, "All"].map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={state === s}
                  onClick={() => setSearchParams(s === "Submitted" ? {} : { state: s }, { replace: true })}
                  className={state === s ? "rounded bg-primary px-3 py-1 text-[13px] font-medium text-primary-foreground" : "rounded px-3 py-1 text-[13px] text-muted-foreground"}
                >
                  {intl.formatMessage({ id: `expenses.filter.${s}` })}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DataGrid
            gridId="expense-claims"
            columns={columns}
            data={claims}
            rowCount={claims.length}
            isLoading={claimsQuery.isPending}
            getRowId={(row) => row.id}
            onRowClick={(row) => {
              setSelected(row);
              setError(null);
            }}
            emptyMessage={intl.formatMessage({ id: "expenses.hrEmpty" })}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {selected.employeeName} — {selected.title}
              <ExpenseStageBadge stage={selected.stage} />
            </CardTitle>
            <CardDescription>{intl.formatMessage({ id: "expenses.totalValue" }, { total: formatAmount(selected.total) })}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <ul className="flex flex-col divide-y rounded-md border">
              {selected.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
                  <span>
                    {l.date} · {l.description}
                    {l.supplierName && <span className="text-muted-foreground"> · {l.supplierName}{l.supplierFiscalNumber ? ` (${l.supplierFiscalNumber})` : ""}</span>}
                    <span className="block text-xs text-muted-foreground">{l.expenseAccountName}</span>
                  </span>
                  <span className="tabular-nums">{formatAmount(l.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {selected.receipts.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="text-primary hover:underline"
                  onClick={async () => downloadFileResponse(await apiClient.downloadExpenseClaimReceipt(companyId, selected.id, r.id), r.fileName)}
                >
                  {r.fileName}
                </button>
              ))}
              {selected.receipts.length === 0 && <span className="text-muted-foreground">{intl.formatMessage({ id: "expenses.noReceipts" })}</span>}
            </div>

            {selected.stage === "Submitted" && canApprove("hr") && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex grow flex-col gap-1">
                  <Label htmlFor="claim-note">{intl.formatMessage({ id: "expenses.note" })}</Label>
                  <Input id="claim-note" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
                  {intl.formatMessage({ id: "expenses.approveAndDraftBill" })}
                </Button>
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
                  {intl.formatMessage({ id: "me.leave.reject" })}
                </Button>
              </div>
            )}

            {selected.billId && (
              <p>
                <Link className="text-primary hover:underline" to={`/bills/${selected.billId}`}>
                  {intl.formatMessage({ id: selected.stage === "BillDraft" ? "expenses.openBillToPost" : "expenses.openBill" })}
                </Link>
              </p>
            )}

            {selected.stage === "Posted" && canWrite("payroll") && (
              selected.payrollReimbursementPeriod ? (
                <p className="text-muted-foreground">
                  {intl.formatMessage({ id: "expenses.scheduledForPayroll" }, { month: selected.payrollReimbursementPeriod.slice(0, 7) })}
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="claim-month">{intl.formatMessage({ id: "expenses.reimburseMonth" })}</Label>
                    <Input id="claim-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" disabled={reimburse.isPending} onClick={() => reimburse.mutate()}>
                    {intl.formatMessage({ id: "expenses.reimburseViaPayroll" })}
                  </Button>
                  <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "expenses.reimburseHint" })}</span>
                </div>
              )
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
