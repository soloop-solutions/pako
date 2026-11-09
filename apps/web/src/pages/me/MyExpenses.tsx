import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import type { ExpenseClaimLineRequest, ExpenseClaimResponse } from "@pako/shared";

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
import { cn } from "@/lib/utils";
import { ExpenseStageBadge } from "@/pages/me/ExpenseStageBadge";
import { Select } from "@/components/ui/select";

interface LineDraft {
  key: number;
  date: string;
  description: string;
  expenseAccountId: string;
  amount: string;
  taxDefinitionId: string;
  supplierName: string;
  supplierFiscalNumber: string;
}

let nextKey = 1;
const emptyLine = (): LineDraft => ({
  key: nextKey++,
  date: new Date().toISOString().slice(0, 10),
  description: "",
  expenseAccountId: "",
  amount: "",
  taxDefinitionId: "",
  supplierName: "",
  supplierFiscalNumber: "",
});

// H13 self-service: my expense claims (draft → submitted → approved/bill → reimbursed) and, for
// managers, the team's claims waiting for approval. Totals and balances are the API's.
export function MyExpenses() {
  const intl = useIntl();
  const { activeCompanyId: companyId } = useCompany();
  const { access } = useMyAccess();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "team" && access?.isTeamManager ? "team" : "mine";

  const [editing, setEditing] = useState<ExpenseClaimResponse | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  // Field-level validation: "title" or "lineKey:field"
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const claimsQuery = useQuery({
    queryKey: ["me", "expenseClaims", companyId],
    queryFn: () => apiClient.listMyExpenseClaims(companyId as string),
    enabled: !!companyId,
  });
  const optionsQuery = useQuery({
    queryKey: ["me", "expenseOptions", companyId],
    queryFn: () => apiClient.getMyExpenseOptions(companyId as string),
    enabled: !!companyId,
  });
  const teamQuery = useQuery({
    queryKey: ["me", "teamExpenseClaims", companyId],
    queryFn: () => apiClient.listMyTeamExpenseClaims(companyId as string),
    enabled: !!companyId && !!access?.isTeamManager,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["me"] });
  const onError = (fallback: string) => (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: fallback })));

  function open(claim: ExpenseClaimResponse | "new") {
    setEditing(claim);
    setError(null);
    setFieldErrors({});
    if (claim === "new") {
      setTitle("");
      setLines([emptyLine()]);
      return;
    }
    setTitle(claim.title);
    setLines(
      claim.lines.map((l) => ({
        key: nextKey++,
        date: l.date,
        description: l.description,
        expenseAccountId: l.expenseAccountId,
        amount: String(l.amount),
        taxDefinitionId: l.taxDefinitionId ?? "",
        supplierName: l.supplierName ?? "",
        supplierFiscalNumber: l.supplierFiscalNumber ?? "",
      })),
    );
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        lines: lines.map(
          (l): ExpenseClaimLineRequest => ({
            date: l.date,
            description: l.description.trim(),
            expenseAccountId: l.expenseAccountId,
            amount: Number(l.amount.replace(",", ".")),
            taxDefinitionId: l.taxDefinitionId || undefined,
            supplierName: l.supplierName.trim() || undefined,
            supplierFiscalNumber: l.supplierFiscalNumber.trim() || undefined,
          }),
        ),
      };
      return editing && editing !== "new"
        ? apiClient.updateMyExpenseClaim(companyId as string, editing.id, body)
        : apiClient.createMyExpenseClaim(companyId as string, body);
    },
    onSuccess: (saved) => {
      setError(null);
      setEditing(saved);
      refresh();
    },
    onError: onError("expenses.saveError"),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => apiClient.submitMyExpenseClaim(companyId as string, id),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: onError("expenses.submitError"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.cancelMyExpenseClaim(companyId as string, id),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: onError("expenses.saveError"),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      apiClient.uploadMyExpenseReceipt(companyId as string, id, { data: file, fileName: file.name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me", "expenseClaims", companyId] });
      const fresh = (await apiClient.listMyExpenseClaims(companyId as string)).find((c) => editing !== "new" && c.id === editing?.id);
      if (fresh) setEditing(fresh);
    },
    onError: onError("expenses.receiptError"),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve
        ? apiClient.approveTeamExpenseClaim(companyId as string, id, { note: undefined })
        : apiClient.rejectTeamExpenseClaim(companyId as string, id, { note: window.prompt(intl.formatMessage({ id: "expenses.rejectReason" })) ?? undefined }),
    onSuccess: refresh,
    onError: onError("expenses.decideError"),
  });

  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    // Clear field errors for the changed fields
    for (const field of Object.keys(patch)) {
      clearFieldError(`${key}:${field}`);
    }
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!title.trim()) {
      errors.title = intl.formatMessage({ id: "expenses.error.titleRequired" });
    }
    for (const line of lines) {
      if (!line.date) {
        errors[`${line.key}:date`] = intl.formatMessage({ id: "expenses.error.dateRequired" });
      }
      if (!line.description.trim()) {
        errors[`${line.key}:description`] = intl.formatMessage({ id: "expenses.error.descriptionRequired" });
      }
      if (!line.expenseAccountId) {
        errors[`${line.key}:expenseAccountId`] = intl.formatMessage({ id: "expenses.error.categoryRequired" });
      }
      if (!line.amount) {
        errors[`${line.key}:amount`] = intl.formatMessage({ id: "expenses.error.amountRequired" });
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError(null);
      return;
    }
    saveMutation.mutate();
  }

  const columns = useMemo<ColumnDef<ExpenseClaimResponse>[]>(
    () => [
      ...(tab === "team" ? [{ accessorKey: "employeeName", header: intl.formatMessage({ id: "me.leave.employee" }) } as ColumnDef<ExpenseClaimResponse>] : []),
      { accessorKey: "title", header: intl.formatMessage({ id: "expenses.title" }) },
      {
        accessorKey: "createdAt",
        header: intl.formatMessage({ id: "expenses.created" }),
        cell: ({ getValue }) => (getValue() as string).slice(0, 10),
      },
      { accessorKey: "total", header: intl.formatMessage({ id: "expenses.total" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "stage", header: intl.formatMessage({ id: "me.payslips.status" }), cell: ({ getValue }) => <ExpenseStageBadge stage={getValue() as string} /> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          tab === "team" ? (
            <div className="flex justify-end gap-1">
              <Button size="xs" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ id: row.original.id, approve: true })}>
                {intl.formatMessage({ id: "me.leave.approve" })}
              </Button>
              <Button size="xs" variant="outline" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ id: row.original.id, approve: false })}>
                {intl.formatMessage({ id: "me.leave.reject" })}
              </Button>
            </div>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, tab, decideMutation.isPending],
  );

  if (!companyId) return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;

  const claims = tab === "team" ? teamQuery.data ?? [] : claimsQuery.data ?? [];
  const options = optionsQuery.data;
  const editable = editing === "new" || (editing && editing.stage === "Draft");
  const saved = editing && editing !== "new" ? editing : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "nav.myExpenses" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "nav.myExpenses.description" })}</p>
        </div>
        <div className="flex gap-2">
          {access?.isTeamManager && (
            <div role="tablist" className="flex gap-1 rounded-md border p-0.5">
              {(["mine", "team"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setSearchParams(id === "team" ? { tab: "team" } : {}, { replace: true })}
                  className={cn("rounded px-3 py-1 text-[13px] font-medium", tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                >
                  {intl.formatMessage({ id: `me.leave.tab.${id}` }, { count: teamQuery.data?.length ?? 0 })}
                </button>
              ))}
            </div>
          )}
          {tab === "mine" && !editing && (
            <Button size="sm" onClick={() => open("new")}>
              <Plus className="size-4" />
              {intl.formatMessage({ id: "expenses.new" })}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {editing && tab === "mine" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {editing === "new" ? intl.formatMessage({ id: "expenses.new" }) : editing.title}
              {saved && <ExpenseStageBadge stage={saved.stage} />}
            </CardTitle>
            {saved?.decisionNote && <CardDescription>{saved.decisionNote}</CardDescription>}
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={handleSave}>
              <div className="flex flex-col gap-1 sm:max-w-md">
                <Label htmlFor="claim-title">{intl.formatMessage({ id: "expenses.title" })}</Label>
                <Input
                  id="claim-title"
                  disabled={!editable}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    clearFieldError("title");
                  }}
                  className={fieldErrors.title ? "border-destructive" : ""}
                  aria-invalid={!!fieldErrors.title}
                />
                {fieldErrors.title && <p className="text-xs text-destructive">{fieldErrors.title}</p>}
              </div>

              {lines.map((line, index) => {
                const lineErrors = {
                  date: fieldErrors[`${line.key}:date`],
                  description: fieldErrors[`${line.key}:description`],
                  expenseAccountId: fieldErrors[`${line.key}:expenseAccountId`],
                  amount: fieldErrors[`${line.key}:amount`],
                };
                const hasLineErrors = lineErrors.date || lineErrors.description || lineErrors.expenseAccountId || lineErrors.amount;
                return (
                <fieldset key={line.key} disabled={!editable} className={cn("grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-8", hasLineErrors && "border-destructive")}>
                  <div className="flex flex-col gap-0.5">
                    <Input
                      aria-label={intl.formatMessage({ id: "expenses.line.date" })}
                      type="date"
                      value={line.date}
                      onChange={(e) => updateLine(line.key, { date: e.target.value })}
                      className={lineErrors.date ? "border-destructive" : ""}
                      aria-invalid={!!lineErrors.date}
                    />
                    {lineErrors.date && <p className="text-xs text-destructive">{lineErrors.date}</p>}
                  </div>
                  <div className="flex flex-col gap-0.5 sm:col-span-2">
                    <Input
                      aria-label={intl.formatMessage({ id: "expenses.line.description" })}
                      placeholder={intl.formatMessage({ id: "expenses.line.description" })}
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      className={lineErrors.description ? "border-destructive" : ""}
                      aria-invalid={!!lineErrors.description}
                    />
                    {lineErrors.description && <p className="text-xs text-destructive">{lineErrors.description}</p>}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <Select
                      aria-label={intl.formatMessage({ id: "expenses.line.category" })}
                      value={line.expenseAccountId}
                      onValueChange={(v) => updateLine(line.key, { expenseAccountId: v })}
                      options={[
                        { value: "", label: `${intl.formatMessage({ id: "expenses.line.category" })}…` },
                        ...(options?.accounts ?? []).map((a) => ({ value: a.id, label: a.label })),
                      ]}
                    />
                    {lineErrors.expenseAccountId && <p className="text-xs text-destructive">{lineErrors.expenseAccountId}</p>}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <Input
                      aria-label={intl.formatMessage({ id: "expenses.line.amount" })}
                      placeholder="0.00"
                      inputMode="decimal"
                      className={cn("text-right tabular-nums", lineErrors.amount && "border-destructive")}
                      value={line.amount}
                      onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                      aria-invalid={!!lineErrors.amount}
                    />
                    {lineErrors.amount && <p className="text-xs text-destructive">{lineErrors.amount}</p>}
                  </div>
                  <Select aria-label={intl.formatMessage({ id: "expenses.line.vat" })} value={line.taxDefinitionId} onValueChange={(v) => updateLine(line.key, { taxDefinitionId: v })} options={[{ value: "", label: intl.formatMessage({ id: "expenses.line.noVat" }) }, ...(options?.taxes ?? []).map((t) => ({ value: t.id, label: t.label }))]} />
                  <Input
                    aria-label={intl.formatMessage({ id: "expenses.line.supplier" })}
                    placeholder={intl.formatMessage({ id: "expenses.line.supplier" })}
                    value={line.supplierName}
                    onChange={(e) => updateLine(line.key, { supplierName: e.target.value })}
                  />
                  <div className="flex gap-1">
                    <Input
                      aria-label={intl.formatMessage({ id: "expenses.line.supplierNui" })}
                      placeholder="NUI"
                      value={line.supplierFiscalNumber}
                      onChange={(e) => updateLine(line.key, { supplierFiscalNumber: e.target.value })}
                    />
                    {editable && lines.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={intl.formatMessage({ id: "expenses.line.remove" }, { n: index + 1 })}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </fieldset>
                );
              })}

              {saved && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Paperclip className="size-4 text-muted-foreground" />
                  {saved.receipts.length === 0 && <span className="text-muted-foreground">{intl.formatMessage({ id: "expenses.noReceipts" })}</span>}
                  {saved.receipts.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="text-primary hover:underline"
                      onClick={async () =>
                        downloadFileResponse(await apiClient.downloadMyExpenseReceipt(companyId, saved.id, r.id), r.fileName)
                      }
                    >
                      {r.fileName}
                    </button>
                  ))}
                  {editable && (
                    <label className="cursor-pointer text-primary hover:underline">
                      {intl.formatMessage({ id: "expenses.addReceipt" })}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        capture="environment"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadMutation.mutate({ id: saved.id, file });
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {editable && (
                  <>
                    <Button type="button" size="sm" variant="outline" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
                      <Plus className="size-4" />
                      {intl.formatMessage({ id: "expenses.addLine" })}
                    </Button>
                    <Button type="submit" size="sm" variant="outline" disabled={saveMutation.isPending}>
                      {intl.formatMessage({ id: "expenses.saveDraft" })}
                    </Button>
                  </>
                )}
                {saved?.stage === "Draft" && (
                  <Button type="button" size="sm" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate(saved.id)}>
                    {intl.formatMessage({ id: "expenses.submit" })}
                  </Button>
                )}
                {saved && (saved.stage === "Draft" || saved.stage === "Submitted") && (
                  <Button type="button" size="sm" variant="ghost" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(saved.id)}>
                    {intl.formatMessage({ id: "expenses.cancelClaim" })}
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  {intl.formatMessage({ id: "hr.common.close" })}
                </Button>
                {saved && <span className="ml-auto text-sm font-medium tabular-nums">{intl.formatMessage({ id: "expenses.totalValue" }, { total: formatAmount(saved.total) })}</span>}
              </div>
              {editing === "new" && <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "expenses.saveFirstHint" })}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      <DataGrid
        gridId={tab === "team" ? "team-expense-claims" : "my-expense-claims"}
        columns={columns}
        data={claims}
        rowCount={claims.length}
        isLoading={tab === "team" ? teamQuery.isPending : claimsQuery.isPending}
        getRowId={(row) => row.id}
        onRowClick={tab === "mine" ? (row) => open(row) : undefined}
        emptyMessage={intl.formatMessage({ id: tab === "team" ? "expenses.teamEmpty" : "expenses.empty" })}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
      />
    </div>
  );
}
