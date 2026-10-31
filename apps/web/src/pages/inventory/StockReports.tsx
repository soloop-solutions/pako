import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { MarginRowResponse, StockValuationAccountResponse, StockValuationRowResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { cn } from "@/lib/utils";

const TABS = ["valuation", "margin"] as const;

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// docs/INVENTORY_PLAN.md §5.5 — stock valuation as of a date (tied to the ledger, account by account)
// and gross margin per item, customer or month. Every figure comes from the API as-is.
export function StockReports() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [tab, setTab] = useUrlParam("tab", "valuation");

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">{t("nav.stockReports")}</h2>
        <p className="text-sm text-muted-foreground">{t("nav.stockReports.description")}</p>
      </div>
      <div role="tablist" aria-label={t("nav.stockReports")} className="flex gap-1 border-b">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`stock.report.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "margin" ? <MarginTab /> : <ValuationTab />}</div>
    </div>
  );
}

function ValuationTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [asOf, setAsOf] = useUrlParam("asOf", isoDate(new Date()));
  const query = useQuery({
    queryKey: ["stockValuation", activeCompanyId, asOf],
    queryFn: () => apiClient.getStockValuation(activeCompanyId as string, asOf || undefined),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  const accountColumns = useMemo<ColumnDef<StockValuationAccountResponse>[]>(
    () => [
      { accessorKey: "code", header: t("stock.report.account"), cell: ({ row }) => `${row.original.code} ${row.original.name}` },
      { accessorKey: "stockValue", header: t("stock.report.stockValue"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "ledgerValue", header: t("stock.report.ledgerValue"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const itemColumns = useMemo<ColumnDef<StockValuationRowResponse>[]>(
    () => [
      { accessorKey: "itemCode", header: t("stock.col.code"), meta: { numeric: true } },
      { accessorKey: "itemName", header: t("stock.col.item") },
      { accessorKey: "quantity", header: t("stock.col.quantity"), meta: { numeric: true }, cell: ({ row }) => `${intl.formatNumber(row.original.quantity)} ${row.original.unit}` },
      { accessorKey: "averageCost", header: t("stock.col.averageCost"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number, { maximumFractionDigits: 4 }) },
      { accessorKey: "value", header: t("stock.col.value"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="val-as-of">{t("stock.report.asOf")}</Label>
          <Input id="val-as-of" type="date" className="w-44" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
      </div>
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={t("stock.report.stockValue")} value={formatAmount(data.stockValue)} />
          <Tile label={t("stock.report.ledgerValue")} value={formatAmount(data.ledgerValue)} />
          <Tile label={t("stock.report.difference")} value={formatAmount(data.difference)} warn={data.difference !== 0} />
        </div>
      )}
      {data && data.difference !== 0 && (
        <Alert className="border-warning-border bg-warning text-warning-foreground">
          <AlertDescription>{t("stock.report.differenceHint")}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stock.report.byAccount")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="stock-valuation-accounts"
            columns={accountColumns}
            data={data?.accounts ?? []}
            rowCount={data?.accounts.length ?? 0}
            isLoading={query.isPending}
            getRowId={(r) => r.accountId}
            emptyMessage={t("stock.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stock.report.byItem")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="stock-valuation-items"
            columns={itemColumns}
            data={data?.items ?? []}
            rowCount={data?.items.length ?? 0}
            isLoading={query.isPending}
            getRowId={(r) => r.itemId}
            enableGlobalFilter
            globalFilterPlaceholder={t("stock.search")}
            emptyMessage={t("stock.empty")}
            exportFileName="stock-valuation"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MarginTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const today = new Date();
  const [from, setFrom] = useUrlParam("from", isoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useUrlParam("to", isoDate(today));
  const [groupBy, setGroupBy] = useUrlParam("groupBy", "item");
  const query = useQuery({
    queryKey: ["marginReport", activeCompanyId, from, to, groupBy],
    queryFn: () => apiClient.getMarginReport(activeCompanyId as string, from || undefined, to || undefined, groupBy),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const percent = (v: number | undefined) => (v == null ? "—" : intl.formatNumber(v / 100, { style: "percent", maximumFractionDigits: 1 }));

  const columns = useMemo<ColumnDef<MarginRowResponse>[]>(
    () => [
      { accessorKey: "label", header: t(`stock.report.groupBy.${groupBy}`) },
      ...(groupBy === "item"
        ? [{ accessorKey: "quantity", header: t("stock.col.quantity"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number) } as ColumnDef<MarginRowResponse>]
        : []),
      { accessorKey: "netSales", header: t("stock.report.netSales"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "cost", header: t("stock.report.cost"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "margin", header: t("stock.report.margin"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "marginPercent", header: t("stock.report.marginPercent"), meta: { numeric: true }, cell: ({ getValue }) => percent(getValue() as number | undefined) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, groupBy],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="margin-from">{t("reports.from")}</Label>
          <Input id="margin-from" type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="margin-to">{t("reports.to")}</Label>
          <Input id="margin-to" type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="margin-group">{t("stock.report.groupBy")}</Label>
          <Select
            id="margin-group"
            className="w-44"
            value={groupBy}
            onValueChange={setGroupBy}
            options={["item", "customer", "month"].map((g) => ({ value: g, label: t(`stock.report.groupBy.${g}`) }))}
          />
        </div>
      </div>
      {data && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Tile label={t("stock.report.netSales")} value={formatAmount(data.netSales)} />
          <Tile label={t("stock.report.cost")} value={formatAmount(data.cost)} />
          <Tile label={t("stock.report.margin")} value={formatAmount(data.margin)} />
          <Tile label={t("stock.report.marginPercent")} value={percent(data.marginPercent)} />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stock.report.margin")}</CardTitle>
          <CardDescription>{t("stock.report.marginHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="stock-margin"
            columns={columns}
            data={data?.rows ?? []}
            rowCount={data?.rows.length ?? 0}
            isLoading={query.isPending}
            getRowId={(r) => r.key}
            emptyMessage={t("stock.report.marginEmpty")}
            exportFileName="margin"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", warn && "border-warning-border")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", warn && "text-warning-foreground")}>{value}</div>
    </div>
  );
}
