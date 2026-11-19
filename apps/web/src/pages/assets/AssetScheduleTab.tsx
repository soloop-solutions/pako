import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { FixedAssetScheduleAmounts } from "@pako/shared";
import { useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { PrintButton } from "@/components/shared/PrintButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { downloadFileResponse } from "@/pages/reports/helpers";
import { ExportButton } from "@/pages/reports/shared";

type Row = { id: string; code: string; name: string; categoryName: string; subtotal: boolean } & FixedAssetScheduleAmounts;

const AMOUNT_KEYS: (keyof FixedAssetScheduleAmounts)[] = [
  "costOpening", "additions", "costDisposed", "costClosing",
  "accumulatedOpening", "depreciation", "accumulatedDisposed", "accumulatedClosing",
  "bookValueOpening", "bookValueClosing",
];

// Year-end depreciation schedule: cost and accumulated depreciation rolled forward per asset, with
// the category subtotals and grand total exactly as the API returns them.
export function AssetScheduleTab({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const printRef = useRef<HTMLDivElement>(null);
  const [yearParam, setYear] = useUrlParam("year", "");
  const year = Number(yearParam) || new Date().getFullYear();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["fixedAssetSchedule", companyId, year],
    queryFn: () => apiClient.fixedAssetSchedule(companyId, year),
  });

  const rows = useMemo<Row[]>(() => {
    const data = query.data;
    if (!data) return [];
    const out: Row[] = [];
    for (const category of data.categories) {
      for (const line of data.lines.filter((l) => l.categoryName === category.categoryName)) {
        out.push({ id: line.fixedAssetId, code: line.code, name: line.name, categoryName: line.categoryName, subtotal: false, ...line.amounts });
      }
      out.push({
        id: `subtotal-${category.categoryName}`,
        code: "",
        name: intl.formatMessage({ id: "assets.categoryTotal" }, { category: category.categoryName }),
        categoryName: category.categoryName,
        subtotal: true,
        ...category.amounts,
      });
    }
    return out;
  }, [query.data, intl]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { accessorKey: "code", header: t("assets.col.code") },
      { accessorKey: "name", header: t("assets.col.name") },
      ...AMOUNT_KEYS.map<ColumnDef<Row>>((key) => ({
        accessorKey: key,
        header: t(`assets.schedule.${key}`),
        meta: { numeric: true },
        enableColumnFilter: false,
        cell: ({ getValue }) => formatAmount(getValue() as number),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  async function exportSchedule() {
    setExporting(true);
    setExportError(null);
    try {
      downloadFileResponse(await apiClient.fixedAssetScheduleExport(companyId, year), `fixed-asset-schedule-${year}.xlsx`);
    } catch (err) {
      setExportError(getApiErrorMessage(err, t("reports.exportError")));
    } finally {
      setExporting(false);
    }
  }

  const total = query.data?.total;
  const error = query.isError ? getApiErrorMessage(query.error, t("assets.loadError")) : exportError;

  return (
    <Card ref={printRef}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{intl.formatMessage({ id: "assets.scheduleTitle" }, { year })}</CardTitle>
          <CardDescription>{t("assets.scheduleDescription")}</CardDescription>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="asset-schedule-year" className="text-xs">{t("assets.year")}</Label>
            <Input id="asset-schedule-year" type="number" min="1900" max="2999" className="h-8 w-28" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <ExportButton onClick={() => void exportSchedule()} loading={exporting} />
          <PrintButton contentRef={printRef} landscape />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataGrid
          gridId="fixedAssetSchedule"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => (r.subtotal ? "bg-muted/40 font-semibold" : undefined)}
          emptyMessage={t("assets.scheduleEmpty")}
          footerRow={total ? { label: t("common.total"), cells: Object.fromEntries(AMOUNT_KEYS.map((k) => [k, formatAmount(total[k])])) } : undefined}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
          defaultPageSize={1000}
          pageSizeOptions={[1000]}
        />
      </CardContent>
    </Card>
  );
}
