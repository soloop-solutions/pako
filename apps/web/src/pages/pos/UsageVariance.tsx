import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { UsageVarianceRow } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// docs/POS_PLAN.md §6.2 / P3: per recipe ingredient, what the till's recipes used (theoretical),
// what counts found short or over, what was written off, the shortage as a share of use and its
// value. Every figure is the server's.
export function UsageVariance() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const today = new Date();
  const [from, setFrom] = useUrlParam("from", isoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useUrlParam("to", isoDate(today));

  const report = useQuery({
    queryKey: ["posUsageVariance", activeCompanyId, from, to],
    queryFn: () => apiClient.getUsageVariance(activeCompanyId as string, from || undefined, to || undefined),
    enabled: !!activeCompanyId && !!from && !!to,
    placeholderData: keepPreviousData,
  });
  const rows = report.data?.rows ?? [];

  const columns = useMemo<ColumnDef<UsageVarianceRow>[]>(() => {
    const qty = (key: keyof UsageVarianceRow, header: string): ColumnDef<UsageVarianceRow> => ({
      accessorKey: key,
      header,
      meta: { numeric: true },
      cell: ({ getValue }) => intl.formatNumber(getValue() as number, { maximumFractionDigits: 3 }),
    });
    return [
      { accessorKey: "name", header: t("pos.setup3.variance.ingredient") },
      { accessorKey: "unit", header: t("pos.setup3.variance.unit") },
      qty("theoretical", t("pos.setup3.variance.theoretical")),
      {
        ...qty("countDifference", t("pos.setup3.variance.countDifference")),
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return <span className={v < 0 ? "text-destructive" : undefined}>{intl.formatNumber(v, { maximumFractionDigits: 3 })}</span>;
        },
      },
      qty("writtenOff", t("pos.setup3.variance.writtenOff")),
      {
        accessorKey: "variancePercent",
        header: t("pos.setup3.variance.percent"),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const v = getValue() as number | undefined;
          return v == null ? "—" : <span className={v > 0 ? "font-medium text-destructive" : undefined}>{`${intl.formatNumber(v, { maximumFractionDigits: 2 })} %`}</span>;
        },
      },
      {
        accessorKey: "countDifferenceValue",
        header: t("pos.setup3.variance.value"),
        meta: { numeric: true },
        cell: ({ getValue }) => formatAmount(getValue() as number),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intl]);

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pos.setup3.nav.variance")}</CardTitle>
        <CardDescription>{t("pos.setup3.nav.variance.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="uv-from">{t("pos.report.from")}</Label>
            <Input id="uv-from" type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="uv-to">{t("pos.report.to")}</Label>
            <Input id="uv-to" type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("pos.setup3.variance.hint")}</p>
        {report.error && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(report.error, t("pos.report.loadError"))}</AlertDescription>
          </Alert>
        )}
        <DataGrid
          gridId="pos-usage-variance"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={report.isPending && !!from && !!to}
          getRowId={(r) => r.itemId}
          emptyMessage={t("pos.setup3.variance.empty")}
          exportFileName="usage-variance"
          defaultPageSize={500}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}
