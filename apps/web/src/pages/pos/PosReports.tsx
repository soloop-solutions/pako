import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PosSalesReportRow } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { usePosRegisters, usePosStores } from "@/hooks/usePos";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { POS_REPORT_GROUPS, PosReportGroup, posReportGroupKey } from "@/lib/pos-enums";

const TOTAL_KEY = "__total";
const ALL = "all";

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// docs/POS_PLAN.md P2: store reporting — sales, returns, VAT, discounts (and cost and margin for
// items and categories) grouped by day, hour, store, register, cashier, item, category, tender or
// program. Every figure, the total row included, is the server's.
export function PosReports() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const today = new Date();
  const [from, setFrom] = useUrlParam("from", isoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useUrlParam("to", isoDate(today));
  const [group, setGroup] = useUrlParam("group", String(PosReportGroup.Day));
  const [storeId, setStoreId] = useUrlParam("store", ALL);
  const [registerId, setRegisterId] = useUrlParam("register", ALL);
  const stores = usePosStores().data ?? [];
  const registers = (usePosRegisters().data ?? []).filter((r) => storeId === ALL || r.storeId === storeId);

  const report = useQuery({
    queryKey: ["posSalesReport", activeCompanyId, from, to, group, storeId, registerId],
    queryFn: () =>
      apiClient.getPosSalesReport(
        activeCompanyId as string, from || undefined, to || undefined, Number(group),
        storeId === ALL ? undefined : storeId, registerId === ALL ? undefined : registerId,
      ),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const data = report.data;
  // Cost and margin come only for the item and category groupings.
  const hasCost = !!data && (data.total.cost != null || data.rows.some((r) => r.cost != null));
  const rows = useMemo(() => (data ? [...data.rows, { ...data.total, key: TOTAL_KEY, label: t("pos.report.total") }] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, intl]);

  const columns = useMemo<ColumnDef<PosSalesReportRow>[]>(() => {
    const amount = (key: keyof PosSalesReportRow, header: string): ColumnDef<PosSalesReportRow> => ({
      accessorKey: key,
      header,
      meta: { numeric: true },
      cell: ({ getValue }) => {
        const value = getValue() as number | undefined;
        return value == null ? "—" : formatAmount(value);
      },
    });
    return [
      { accessorKey: "label", header: t(`pos.report.group.${posReportGroupKey(Number(group))}`) },
      { accessorKey: "orders", header: t("pos.report.orders"), meta: { numeric: true } },
      { accessorKey: "quantity", header: t("pos.report.quantity"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number) },
      amount("sales", t("pos.report.sales")),
      amount("returns", t("pos.report.returns")),
      amount("netSales", t("pos.report.netSales")),
      amount("tax", t("pos.report.tax")),
      amount("discount", t("pos.report.discount")),
      ...(hasCost ? [amount("cost", t("pos.report.cost")), amount("margin", t("pos.report.margin"))] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intl, group, hasCost]);

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("nav.posReports")}</CardTitle>
        <CardDescription>{t("nav.posReports.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="pos-report-from">{t("pos.report.from")}</Label>
            <Input id="pos-report-from" type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pos-report-to">{t("pos.report.to")}</Label>
            <Input id="pos-report-to" type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex w-48 flex-col gap-1">
            <Label htmlFor="pos-report-group">{t("pos.report.groupBy")}</Label>
            <Select
              id="pos-report-group"
              value={group}
              onValueChange={setGroup}
              options={POS_REPORT_GROUPS.map((g) => ({ value: String(g), label: t(`pos.report.group.${posReportGroupKey(g)}`) }))}
            />
          </div>
          <div className="flex w-52 flex-col gap-1">
            <Label htmlFor="pos-report-store">{t("pos.register.store")}</Label>
            <Select
              id="pos-report-store"
              value={storeId}
              onValueChange={(v) => {
                setStoreId(v);
                setRegisterId(ALL);
              }}
              options={[{ value: ALL, label: t("pos.program.store.all") }, ...stores.map((s) => ({ value: s.id, label: s.name }))]}
            />
          </div>
          <div className="flex w-52 flex-col gap-1">
            <Label htmlFor="pos-report-register">{t("pos.report.register")}</Label>
            <Select
              id="pos-report-register"
              value={registerId}
              onValueChange={setRegisterId}
              options={[{ value: ALL, label: t("pos.report.register.all") }, ...registers.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))]}
            />
          </div>
        </div>
        {report.error && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(report.error, t("pos.report.loadError"))}</AlertDescription>
          </Alert>
        )}
        <DataGrid
          gridId="pos-sales-report"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={report.isPending}
          getRowId={(r) => r.key}
          getRowClassName={(r) => (r.key === TOTAL_KEY ? "bg-muted font-semibold" : undefined)}
          emptyMessage={t("pos.report.empty")}
          exportFileName="pos-sales"
          defaultPageSize={500}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}
