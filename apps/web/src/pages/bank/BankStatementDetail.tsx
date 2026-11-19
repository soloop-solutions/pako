import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  BankStatementCandidateResponse,
  BankStatementDetailResponse,
  BankStatementLineResponse,
  UpdateBankStatementLineRequest,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-context";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { bankStatementsQueryKey } from "@/lib/bank-statements";
import { formatDisplayDate } from "@/lib/dates";
import { formatAmount } from "@/lib/payroll-enums";

// One imported bank statement: the balance check, each line with the invoice/bill it pays, and
// Confirm, which records the payments (the same posting as "Record payment"). Every amount and
// status comes from the API.

const statusVariant: Record<string, "success" | "info" | "warning" | "outline" | "draft"> = {
  Matched: "success",
  Ready: "info",
  Choose: "warning",
  None: "outline",
  Ignored: "draft",
};

export function BankStatementDetail() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { id } = useParams();
  const statementId = id as string;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { activeCompanyId: companyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<BankStatementLineResponse | null>(null);

  const queryKey = ["bankStatement", companyId, statementId] as const;
  const detail = useQuery({
    queryKey,
    queryFn: () => apiClient.getBankStatement(companyId as string, statementId),
    enabled: !!companyId,
  });

  function applied(next: BankStatementDetailResponse) {
    setError(null);
    queryClient.setQueryData(queryKey, next);
    void queryClient.invalidateQueries({ queryKey: bankStatementsQueryKey(companyId) });
  }

  const update = useMutation({
    mutationFn: ({ lineId, body }: { lineId: string; body: UpdateBankStatementLineRequest }) =>
      apiClient.updateBankStatementLine(companyId as string, statementId, lineId, body),
    onSuccess: (next) => {
      setChoosing(null);
      applied(next);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("bankStatements.updateError"))),
  });

  const post = useMutation({
    mutationFn: (lineId: string) => apiClient.postBankStatementLine(companyId as string, statementId, lineId),
    onSuccess: applied,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("bankStatements.confirmError"))),
  });

  const confirmStatement = useMutation({
    mutationFn: () => apiClient.confirmBankStatement(companyId as string, statementId),
    onSuccess: (next) => {
      applied(next);
      toast.success(t("bankStatements.confirmed", { count: next.lines.filter((l) => l.matchStatus === "Matched").length }));
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("bankStatements.confirmError"))),
  });

  const remove = useMutation({
    mutationFn: () => apiClient.deleteBankStatement(companyId as string, statementId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bankStatementsQueryKey(companyId) });
      void navigate("/bank-statements");
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("bankStatements.deleteError"))),
  });

  const data = detail.data;
  const isDraft = data?.summary.state === "Draft";
  const busy = update.isPending || post.isPending || confirmStatement.isPending;
  const editable = canWrite("accounting") && !busy;

  const columns = useMemo<ColumnDef<BankStatementLineResponse>[]>(
    () => [
      { accessorKey: "rowNumber", header: t("bankStatements.col.row"), meta: { numeric: true } },
      { accessorKey: "date", header: t("bankStatements.col.date"), cell: ({ getValue }) => formatDisplayDate(getValue() as string) },
      { accessorKey: "description", header: t("bankStatements.col.description") },
      {
        id: "partner",
        accessorFn: (l) => l.partnerName ?? l.partnerText ?? "",
        header: t("bankStatements.col.partner"),
      },
      { accessorKey: "reference", header: t("bankStatements.col.reference") },
      {
        accessorKey: "amountIn",
        header: t("bankStatements.col.in"),
        meta: { numeric: true },
        cell: ({ getValue }) => ((getValue() as number) > 0 ? formatAmount(getValue() as number) : ""),
      },
      {
        accessorKey: "amountOut",
        header: t("bankStatements.col.out"),
        meta: { numeric: true },
        cell: ({ getValue }) => ((getValue() as number) > 0 ? formatAmount(getValue() as number) : ""),
      },
      {
        id: "match",
        accessorFn: (l) => l.matchStatus,
        header: t("bankStatements.col.match"),
        cell: ({ row }) => {
          const line = row.original;
          const lineAmount = line.amountIn > 0 ? line.amountIn : line.amountOut;
          return (
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant[line.matchStatus] ?? "outline"}>{t(`bankStatements.status.${line.matchStatus}`)}</Badge>
              {line.isDuplicate && <span className="text-xs text-warning-foreground">{t("bankStatements.duplicate")}</span>}
              {line.documentNumber && <span>{line.documentNumber}</span>}
              {line.matchAmount != null && line.matchAmount < lineAmount && (
                <span className="text-xs text-muted-foreground">
                  {t("bankStatements.partial", { amount: formatAmount(line.matchAmount), line: formatAmount(lineAmount) })}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const line = row.original;
          if (line.state === "Matched") return null;
          return (
            <span className="flex flex-wrap gap-1">
              {editable && line.state === "Open" && (
                <Button size="xs" variant="outline" onClick={() => setChoosing(line)}>
                  {line.matchStatus === "Ready" ? t("bankStatements.change") : t("bankStatements.choose")}
                </Button>
              )}
              {editable && line.matchStatus === "Ready" && (
                <Button size="xs" variant="ghost" onClick={() => update.mutate({ lineId: line.id, body: {} })}>
                  {t("bankStatements.clear")}
                </Button>
              )}
              {editable && line.state === "Open" && (
                <Button size="xs" variant="ghost" onClick={() => update.mutate({ lineId: line.id, body: { ignore: true } })}>
                  {t("bankStatements.ignore")}
                </Button>
              )}
              {editable && line.state === "Ignored" && (
                <Button size="xs" variant="ghost" onClick={() => update.mutate({ lineId: line.id, body: {} })}>
                  {t("bankStatements.reopen")}
                </Button>
              )}
              {!isDraft && line.matchStatus === "Ready" && canApprove("accounting") && (
                <Button size="xs" disabled={busy} onClick={() => post.mutate(line.id)}>
                  {t("bankStatements.record")}
                </Button>
              )}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, editable, isDraft, busy],
  );

  if (!data) {
    return detail.isError ? (
      <Alert variant="destructive">
        <AlertDescription>{getApiErrorMessage(detail.error, t("bankStatements.importError"))}</AlertDescription>
      </Alert>
    ) : null;
  }

  const { summary } = data;
  const readyCount = data.lines.filter((l) => l.matchStatus === "Ready").length;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/bank-statements" className="text-sm text-muted-foreground hover:underline">
        ← {t("bankStatements.back")}
      </Link>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                {t("bankStatements.detailTitle", { from: formatDisplayDate(summary.periodFrom), to: formatDisplayDate(summary.periodTo) })}
                <Badge variant={summary.state === "Confirmed" ? "success" : "draft"}>{t(`bankStatements.state.${summary.state}`)}</Badge>
              </CardTitle>
              <CardDescription>
                {summary.bankAccountName} · {summary.fileName}
              </CardDescription>
            </div>
            {isDraft && (
              <div className="flex gap-2">
                {canWrite("accounting") && (
                  <Button variant="outline" disabled={busy || remove.isPending} onClick={() => confirm(t("bankStatements.deleteQuestion"), () => remove.mutate())}>
                    {t("bankStatements.delete")}
                  </Button>
                )}
                {canApprove("accounting") && (
                  <Button
                    disabled={busy || data.balanceDifference !== 0}
                    onClick={() => confirm(t("bankStatements.confirmQuestion", { count: readyCount }), () => confirmStatement.mutate())}
                  >
                    {t("bankStatements.confirm")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4 [font-variant-numeric:tabular-nums]">
            <Figure label={t("bankStatements.opening")} value={formatAmount(summary.openingBalance)} />
            <Figure label={t("bankStatements.totalIn")} value={formatAmount(summary.totalIn)} />
            <Figure label={t("bankStatements.totalOut")} value={formatAmount(summary.totalOut)} />
            <Figure label={t("bankStatements.closing")} value={formatAmount(summary.closingBalance)} />
          </dl>
          {data.balanceDifference === 0 ? (
            <Alert data-testid="bank-statement-balance">
              <AlertDescription>{t("bankStatements.balanceOk")}</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive" data-testid="bank-statement-balance">
              <AlertDescription>{t("bankStatements.balanceOff", { difference: formatAmount(data.balanceDifference) })}</AlertDescription>
            </Alert>
          )}
          {isDraft && data.ledgerOpeningBalance !== summary.openingBalance && (
            <Alert>
              <AlertDescription className="text-warning-foreground">
                {t("bankStatements.ledgerDiffers", {
                  from: formatDisplayDate(summary.periodFrom),
                  ledger: formatAmount(data.ledgerOpeningBalance),
                  opening: formatAmount(summary.openingBalance),
                })}
              </AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">{t("bankStatements.onlyPayments")}</p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("bankStatements.lines")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="bank-statement-lines"
            columns={columns}
            data={data.lines}
            rowCount={data.lines.length}
            getRowId={(row) => row.id}
            defaultPageSize={100}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      {choosing && companyId && (
        <ChooseDocumentDialog
          companyId={companyId}
          statementId={statementId}
          line={choosing}
          pending={update.isPending}
          onClose={() => setChoosing(null)}
          onChoose={(candidate, amount) =>
            update.mutate({
              lineId: choosing.id,
              body: {
                invoiceId: candidate.kind === "Invoice" ? candidate.id : undefined,
                billId: candidate.kind === "Bill" ? candidate.id : undefined,
                amount,
              },
            })
          }
        />
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

interface ChooseProps {
  companyId: string;
  statementId: string;
  line: BankStatementLineResponse;
  pending: boolean;
  onClose: () => void;
  onChoose: (candidate: BankStatementCandidateResponse, amount: number | undefined) => void;
}

// The open invoices (money in) or bills (money out) this line can pay: the line's partner first, then
// the closest amounts. The amount to apply defaults (on the server) to what both the line and the
// document allow; typing one applies part of it.
function ChooseDocumentDialog({ companyId, statementId, line, pending, onClose, onChoose }: ChooseProps) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BankStatementCandidateResponse | null>(null);
  const [amount, setAmount] = useState("");
  const incoming = line.amountIn > 0;
  const lineAmount = incoming ? line.amountIn : line.amountOut;

  const candidates = useQuery({
    queryKey: ["bankStatementCandidates", companyId, statementId, line.id, search],
    queryFn: () => apiClient.listBankStatementLineCandidates(companyId, statementId, line.id, search.trim() || undefined),
  });

  const columns = useMemo<ColumnDef<BankStatementCandidateResponse>[]>(
    () => [
      { accessorKey: "number", header: t("bankStatements.col.number") },
      { accessorKey: "partnerName", header: t("bankStatements.col.partner") },
      { accessorKey: "issueDate", header: t("bankStatements.col.issueDate"), cell: ({ getValue }) => formatDisplayDate(getValue() as string) },
      { accessorKey: "outstanding", header: t("bankStatements.col.outstanding"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const rows = candidates.data ?? [];
  const typed = amount.trim() === "" ? undefined : Number(amount.replace(",", "."));

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("bankStatements.chooseTitle", {
              row: line.rowNumber,
              amount: formatAmount(lineAmount),
              direction: t(incoming ? "bankStatements.direction.in" : "bankStatements.direction.out"),
            })}
          </DialogTitle>
          <DialogDescription>{line.description}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={t("bankStatements.search")}
          placeholder={t("bankStatements.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <DataGrid
          gridId="bank-statement-candidates"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={candidates.isPending}
          getRowId={(row) => row.id}
          onRowClick={(row) => setSelected(row)}
          getRowClassName={(row) => (row.id === selected?.id ? "bg-accent" : undefined)}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
          emptyMessage={t("bankStatements.candidatesEmpty")}
        />
        {selected && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="bank-statement-amount">{t("bankStatements.amountToApply")}</Label>
            <Input
              id="bank-statement-amount"
              inputMode="decimal"
              className="w-40"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("bankStatements.cancel")}
          </Button>
          <Button
            disabled={!selected || pending || (typed !== undefined && !(typed > 0))}
            onClick={() => selected && onChoose(selected, typed)}
          >
            {t("bankStatements.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
