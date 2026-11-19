import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { DepreciationCategoryTotal, DepreciationPreviewLine, DepreciationRunResponse } from "@pako/shared";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { currentMonthIso, formatMonth } from "@/pages/assets/shared";

function nextMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

// Monthly depreciation: pick a month (kept in the URL), see what it would post per asset and per
// category, post it as one journal entry, and reverse the latest run.
export function DepreciationRunsTab({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { canApprove } = useMyAccess();
  const [error, setError] = useState<string | null>(null);

  const runs = useQuery({ queryKey: ["depreciationRuns", companyId], queryFn: () => apiClient.listDepreciationRuns(companyId) });
  const latestPosted = (runs.data ?? []).find((r) => r.state === "Posted");
  const suggested = latestPosted ? nextMonth(latestPosted.period.slice(0, 7)) : currentMonthIso();
  const [monthParam, setMonth] = useUrlParam("period", "");
  const month = monthParam || suggested;

  const preview = useQuery({
    queryKey: ["depreciationPreview", companyId, month],
    queryFn: () => apiClient.previewDepreciationRun(companyId, `${month}-01`),
    enabled: !!runs.data,
  });

  async function refresh() {
    await Promise.all(
      [["depreciationRuns"], ["depreciationPreview"], ["fixedAssets"], ["fixedAsset"]].map((k) => queryClient.invalidateQueries({ queryKey: [...k, companyId] })),
    );
  }

  const post = useMutation({
    mutationFn: () => apiClient.postDepreciationRun(companyId, { period: `${month}-01` }),
    onSuccess: async (run) => {
      toast.success(intl.formatMessage({ id: "assets.runPosted" }, { month: formatMonth(run.period), total: formatAmount(run.total) }));
      setMonth("");
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("assets.runError"))),
  });

  const reverse = useMutation({
    mutationFn: (runId: string) => apiClient.reverseDepreciationRun(companyId, runId, undefined),
    onSuccess: async (run) => {
      toast.success(intl.formatMessage({ id: "assets.runReversed" }, { month: formatMonth(run.period) }));
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("assets.runError"))),
  });

  const lineColumns = useMemo<ColumnDef<DepreciationPreviewLine>[]>(
    () => [
      { accessorKey: "code", header: t("assets.col.code") },
      { accessorKey: "name", header: t("assets.col.name") },
      { accessorKey: "categoryName", header: t("assets.col.category") },
      { accessorKey: "amount", header: t("assets.col.depreciation"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "accumulatedAfter", header: t("assets.col.accumulatedAfter"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "bookValueAfter", header: t("assets.col.bookValueAfter"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const categoryColumns = useMemo<ColumnDef<DepreciationCategoryTotal>[]>(
    () => [
      { accessorKey: "categoryName", header: t("assets.col.category") },
      { accessorKey: "expenseAccountCode", header: t("assets.col.debit") },
      { accessorKey: "accumulatedAccountCode", header: t("assets.col.credit") },
      { accessorKey: "amount", header: t("assets.col.depreciation"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const runColumns = useMemo<ColumnDef<DepreciationRunResponse>[]>(
    () => [
      { accessorKey: "period", header: t("assets.col.month"), cell: ({ getValue }) => formatMonth(getValue() as string) },
      { accessorKey: "total", header: t("assets.col.depreciation"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "assetCount", header: t("assets.col.assetCount"), meta: { numeric: true } },
      {
        accessorKey: "state",
        header: t("assets.col.status"),
        cell: ({ getValue }) => (getValue() === "Posted"
          ? <Badge variant="default">{t("assets.posted")}</Badge>
          : <Badge variant="secondary" className="line-through">{t("assets.reversed")}</Badge>),
      },
      {
        id: "entry",
        header: t("assets.col.entry"),
        enableSorting: false,
        cell: ({ row }) => <Link className="underline" to={`/ledger?entry=${row.original.journalEntryId}`}>{t("assets.openEntry")}</Link>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const data = preview.data;
  const canPost = canApprove("accounting") && !!data && !data.alreadyPosted && data.lines.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("assets.runTitle")}</CardTitle>
          <CardDescription>{t("assets.runDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="depreciation-month">{t("assets.col.month")}</Label>
              <Input id="depreciation-month" type="month" className="h-8 w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            {data && (
              <p className="pb-1 text-sm" data-testid="depreciation-total">
                {intl.formatMessage({ id: "assets.runTotal" }, { total: formatAmount(data.total), count: data.lines.length })}
              </p>
            )}
            {canApprove("accounting") && (
              <Button
                type="button"
                className="ml-auto"
                disabled={!canPost || post.isPending}
                onClick={() => confirm(intl.formatMessage({ id: "assets.runConfirm" }, { month: formatMonth(month), total: formatAmount(data?.total) }), () => {
                  setError(null);
                  post.mutate();
                })}
              >
                {intl.formatMessage({ id: "assets.runPost" }, { month: formatMonth(month) })}
              </Button>
            )}
          </div>
          {data?.alreadyPosted && <p className="text-sm text-muted-foreground">{t("assets.runAlreadyPosted")}</p>}
          {data?.lastPostedPeriod && !data.alreadyPosted && month < data.lastPostedPeriod.slice(0, 7) && (
            <p className="text-sm text-warning-foreground">{t("assets.runBeforeLast")}</p>
          )}
          {preview.isError && (
            <Alert variant="destructive">
              <AlertDescription>{getApiErrorMessage(preview.error, t("assets.runError"))}</AlertDescription>
            </Alert>
          )}
          {data && data.categories.length > 0 && (
            <DataGrid
              gridId="depreciationCategories"
              columns={categoryColumns}
              data={data.categories}
              rowCount={data.categories.length}
              getRowId={(c) => c.categoryId}
              footerRow={{ label: t("common.total"), cells: { amount: formatAmount(data.total) } }}
              manualFiltering={false}
              manualSorting={false}
              manualGrouping={false}
              defaultPageSize={200}
              pageSizeOptions={[200]}
            />
          )}
          <DataGrid
            gridId="depreciationPreview"
            columns={lineColumns}
            data={data?.lines ?? []}
            rowCount={data?.lines.length ?? 0}
            isLoading={preview.isPending}
            getRowId={(l) => l.fixedAssetId}
            emptyMessage={t(data?.alreadyPosted ? "assets.runAlreadyPosted" : "assets.runNothing")}
            exportFileName={`depreciation-${month}`}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={500}
            pageSizeOptions={[100, 500]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("assets.runHistory")}</CardTitle>
          <CardDescription>{t("assets.runHistoryDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {latestPosted && canApprove("accounting") && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reverse.isPending}
                onClick={() => confirm(intl.formatMessage({ id: "assets.reverseConfirm" }, { month: formatMonth(latestPosted.period) }), () => {
                  setError(null);
                  reverse.mutate(latestPosted.id);
                }, { confirmLabel: t("assets.reverse"), destructive: true })}
              >
                {intl.formatMessage({ id: "assets.reverseLatest" }, { month: formatMonth(latestPosted.period) })}
              </Button>
            </div>
          )}
          <DataGrid
            gridId="depreciationRuns"
            columns={runColumns}
            data={runs.data ?? []}
            rowCount={runs.data?.length ?? 0}
            isLoading={runs.isPending}
            getRowId={(r) => r.id}
            getRowClassName={(r) => (r.state === "Posted" ? undefined : "text-muted-foreground")}
            emptyMessage={t("assets.runHistoryEmpty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={240}
            pageSizeOptions={[240]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
