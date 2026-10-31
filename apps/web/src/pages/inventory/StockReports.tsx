import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { GrniRowResponse, LotStockResponse, MarginRowResponse, StockValuationAccountResponse, StockValuationRowResponse } from "@pako/shared";
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

const TABS = ["valuation", "margin", "grni", "lots"] as const;

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
      <div role="tabpanel">{tab === "margin" ? <MarginTab /> : tab === "grni" ? <GrniTab /> : tab === "lots" ? <LotsTab /> : <ValuationTab />}</div>
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
          {/* Phase 2: write-downs to net realisable value (account 120900). */}
          {data.writeDownAllowance !== 0 && (
            <>
              <Tile label={t("stock.report.writeDownAllowance")} value={formatAmount(data.writeDownAllowance)} />
              <Tile label={t("stock.report.netValue")} value={formatAmount(data.netValue)} />
            </>
          )}
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

// §12 P6: receipts still waiting for the vendor's bill, tied to account 120800.
function GrniTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [asOf, setAsOf] = useUrlParam("grniAsOf", isoDate(new Date()));
  const query = useQuery({
    queryKey: ["grni", activeCompanyId, asOf],
    queryFn: () => apiClient.getGrniReport(activeCompanyId as string, asOf || undefined),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const columns = useMemo<ColumnDef<GrniRowResponse>[]>(
    () => [
      { accessorKey: "date", header: t("stock.card.date"), cell: ({ getValue }) => intl.formatDate(new Date(`${getValue() as string}T00:00`), { dateStyle: "medium" }) },
      { accessorKey: "receiptNumber", header: t("stock.doc.number") },
      { accessorKey: "partnerName", header: t("po.col.vendor") },
      { accessorKey: "itemName", header: t("stock.col.item"), cell: ({ row }) => `${row.original.itemCode} ${row.original.itemName}` },
      { accessorKey: "received", header: t("stock.grni.received"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number) },
      { accessorKey: "billed", header: t("po.col.billed"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number) },
      { accessorKey: "open", header: t("stock.grni.open"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number) },
      { accessorKey: "openValue", header: t("stock.grni.openValue"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "ageDays", header: t("stock.grni.age"), meta: { numeric: true } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="grni-as-of">{t("stock.report.asOf")}</Label>
        <Input id="grni-as-of" type="date" className="w-44" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={t("stock.grni.openValue")} value={formatAmount(data.openValue)} />
          <Tile label={t("stock.grni.ledger")} value={formatAmount(data.ledgerValue)} />
          <Tile label={t("stock.report.difference")} value={formatAmount(data.difference)} warn={data.difference !== 0} />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stock.report.grni")}</CardTitle>
          <CardDescription>{t("stock.grni.hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="grni"
            columns={columns}
            data={data?.rows ?? []}
            rowCount={data?.rows.length ?? 0}
            isLoading={query.isPending}
            getRowId={(r) => `${r.receiptId}-${r.itemId}`}
            emptyMessage={t("stock.grni.empty")}
            exportFileName="grni"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// §12 P8: lots on hand, the earliest expiry first; a date keeps the lots expiring by then.
function LotsTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [before, setBefore] = useUrlParam("expiringBefore", "");
  const query = useQuery({
    queryKey: ["lotStock", activeCompanyId, before],
    queryFn: () => apiClient.listLotStock(activeCompanyId as string, undefined, undefined, before || undefined),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const columns = useMemo<ColumnDef<LotStockResponse>[]>(
    () => [
      {
        accessorKey: "expiryDate",
        header: t("stock.lot.expiry"),
        cell: ({ row }) => {
          const d = row.original.daysToExpiry;
          const date = row.original.expiryDate ? intl.formatDate(new Date(`${row.original.expiryDate}T00:00`), { dateStyle: "medium" }) : "—";
          return <span className={cn(d != null && d < 0 && "font-semibold text-destructive", d != null && d >= 0 && d <= 30 && "text-warning-foreground")}>{date}</span>;
        },
      },
      { accessorKey: "daysToExpiry", header: t("stock.lot.days"), meta: { numeric: true }, cell: ({ getValue }) => (getValue() == null ? "—" : String(getValue())) },
      { accessorKey: "lotNumber", header: t("stock.lot.number") },
      { accessorKey: "itemName", header: t("stock.col.item"), cell: ({ row }) => `${row.original.itemCode} ${row.original.itemName}` },
      { accessorKey: "warehouseName", header: t("stock.warehouse") },
      { accessorKey: "quantity", header: t("stock.col.quantity"), meta: { numeric: true }, cell: ({ row }) => `${intl.formatNumber(row.original.quantity)} ${row.original.unit}` },
      { accessorKey: "value", header: t("stock.col.value"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("stock.report.lots")}</CardTitle>
          <CardDescription>{t("stock.lot.hint")}</CardDescription>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lots-before">{t("stock.lot.expiringBefore")}</Label>
          <Input id="lots-before" type="date" className="w-44" value={before} onChange={(e) => setBefore(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent>
        <DataGrid
          gridId="lot-stock"
          columns={columns}
          data={query.data ?? []}
          rowCount={query.data?.length ?? 0}
          isLoading={query.isPending}
          getRowId={(r) => `${r.lotId}-${r.warehouseId}`}
          emptyMessage={t("stock.lot.empty")}
          exportFileName="lots"
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
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
