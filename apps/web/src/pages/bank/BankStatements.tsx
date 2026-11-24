import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { BankStatementImportError, BankStatementSummaryResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { ListRibbon } from "@/components/list/ListRibbon";
import { BankStatementTotalsBar } from "@/components/list/ListTotalsBar";
import { LIST_SURFACE, PageHeader } from "@/components/list/PageHeader";
import { useListFilters } from "@/components/list/useListFilters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { formatDisplayDate } from "@/lib/dates";
import { bankStatementsQueryKey } from "@/lib/bank-statements";
import { downloadFileResponse } from "@/lib/download";
import { formatAmount } from "@/lib/payroll-enums";

// Bank statement import (docs/BANK_STATEMENTS.md): pick the bank account, download its Excel template,
// upload it filled in. The upload opens the statement to check the matches and confirm.

const GRID_ID = "bank-statements";
const RIBBON_FILTERS = ["from", "to", "bankAccountId", "state"] as const;
const STATES = ["Draft", "Confirmed"] as const;

export function BankStatements() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId: companyId } = useCompany();
  const { canWrite } = useMyAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const [importErrors, setImportErrors] = useState<BankStatementImportError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const accounts = useQuery({
    queryKey: ["bankStatementAccounts", companyId],
    queryFn: () => apiClient.listBankStatementAccounts(companyId as string),
    enabled: !!companyId,
  });
  // Client request 2026-11-24: the list ribbon (period, account, state), filtered on the server,
  // with the server's totals of what it shows.
  const ribbon = useListFilters(GRID_ID, RIBBON_FILTERS);
  const f = ribbon.values;
  const stateIndex = STATES.indexOf(f.state as (typeof STATES)[number]);
  const listArgs = [
    f.bankAccountId || undefined,
    stateIndex >= 0 ? stateIndex : undefined,
    f.from || undefined,
    f.to || undefined,
  ] as const;
  const statements = useQuery({
    queryKey: [...bankStatementsQueryKey(companyId), "list", ...listArgs],
    queryFn: () => apiClient.listBankStatements(companyId as string, ...listArgs),
    enabled: !!companyId,
  });
  const totals = useQuery({
    queryKey: [...bankStatementsQueryKey(companyId), "totals", ...listArgs],
    queryFn: () => apiClient.bankStatementListTotals(companyId as string, ...listArgs),
    enabled: !!companyId,
  });

  const accountId = searchParams.get("account") ?? accounts.data?.[0]?.id ?? "";

  const upload = useMutation({
    mutationFn: (file: File) =>
      apiClient.importBankStatement(companyId as string, { data: file, fileName: file.name }, accountId),
    onSuccess: (result) => {
      setError(null);
      setImportErrors(result.errors);
      if (result.statement) {
        void queryClient.invalidateQueries({ queryKey: bankStatementsQueryKey(companyId) });
        void navigate(`/bank-statements/${result.statement.summary.id}`);
      }
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("bankStatements.importError"))),
  });

  async function downloadTemplate() {
    setDownloading(true);
    try {
      downloadFileResponse(await apiClient.downloadBankStatementTemplate(companyId as string, accountId), "bank-statement-template.xlsx");
    } catch (err) {
      setError(getApiErrorMessage(err, t("bankStatements.downloadError")));
    } finally {
      setDownloading(false);
    }
  }

  const columns = useMemo<ColumnDef<BankStatementSummaryResponse>[]>(
    () => [
      {
        id: "period",
        accessorFn: (s) => s.periodFrom,
        header: t("bankStatements.col.period"),
        cell: ({ row }) => `${formatDisplayDate(row.original.periodFrom)} – ${formatDisplayDate(row.original.periodTo)}`,
      },
      { accessorKey: "bankAccountName", header: t("bankStatements.col.account") },
      { accessorKey: "fileName", header: t("bankStatements.col.file") },
      { accessorKey: "totalIn", header: t("bankStatements.col.in"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "totalOut", header: t("bankStatements.col.out"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      {
        id: "lines",
        accessorFn: (s) => s.openCount,
        header: t("bankStatements.col.lines"),
        cell: ({ row }) =>
          t("bankStatements.linesSummary", { matched: row.original.matchedCount, open: row.original.openCount, total: row.original.lineCount }),
      },
      {
        accessorKey: "state",
        header: t("bankStatements.col.state"),
        cell: ({ row }) => (
          <Badge variant={row.original.state === "Confirmed" ? "success" : "draft"}>{t(`bankStatements.state.${row.original.state}`)}</Badge>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const rows = statements.data ?? [];
  const hasAccounts = (accounts.data?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("bankStatements.title")} description={t("bankStatements.description")} />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          {accounts.isSuccess && !hasAccounts ? (
            <p className="text-sm text-muted-foreground">{t("bankStatements.noAccounts")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="bank-statement-account">{t("bankStatements.account")}</Label>
                <Select
                  id="bank-statement-account"
                  aria-label={t("bankStatements.account")}
                  className="w-72"
                  value={accountId}
                  onValueChange={(value) => setSearchParams({ account: value }, { replace: true })}
                  options={(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))}
                />
              </div>
              <Button variant="outline" disabled={!accountId || downloading} onClick={() => void downloadTemplate()}>
                {t("bankStatements.downloadTemplate")}
              </Button>
              {canWrite("accounting") && (
                <label
                  className={`inline-flex h-9 items-center rounded-md border px-3 text-sm ${accountId && !upload.isPending ? "cursor-pointer" : "pointer-events-none opacity-50"}`}
                >
                  {upload.isPending ? t("bankStatements.uploading") : t("bankStatements.upload")}
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="sr-only"
                    data-testid="bank-statement-file"
                    disabled={!accountId || upload.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload.mutate(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {importErrors.length > 0 && (
            <Alert variant="destructive" data-testid="bank-statement-import-errors">
              <AlertDescription>
                <p>{t("bankStatements.importErrors")}</p>
                <ul className="mt-1 list-disc pl-5">
                  {importErrors.map((e, i) => (
                    <li key={i}>{e.row > 0 ? `${t("bankStatements.row", { row: e.row })}: ${e.message}` : e.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className={LIST_SURFACE}>
        <CardContent className="flex flex-col gap-3">
          <ListRibbon
            controls={ribbon}
            dateLabelId="bankStatements.col.period"
            selects={[
              {
                name: "bankAccountId",
                labelId: "bankStatements.col.account",
                className: "w-52",
                options: (accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
              },
              {
                name: "state",
                labelId: "bankStatements.col.state",
                className: "w-36",
                options: STATES.map((s) => ({ value: s, label: t(`bankStatements.state.${s}`) })),
              },
            ]}
          />
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={rows}
            rowCount={rows.length}
            isLoading={statements.isPending}
            getRowId={(row) => row.id}
            getRowLink={(row) => `/bank-statements/${row.id}`}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            emptyMessage={t("bankStatements.empty")}
          />
          <BankStatementTotalsBar totals={totals.data} isLoading={totals.isFetching} />
        </CardContent>
      </Card>
    </div>
  );
}
