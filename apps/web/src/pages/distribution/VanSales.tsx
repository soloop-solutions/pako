import { useEffect, useMemo, useRef, type ReactNode, type Ref } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { VanLoadLineResponse, VanSettlementLineResponse, VanSettlementResponse } from "@pako/shared";
import { ArrowLeftRight } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { PrintButton } from "@/components/shared/PrintButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useWarehouses } from "@/hooks/useStock";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { formatIsoDate, isoToday } from "@/lib/sales-order-enums";
import { StockDocumentType } from "@/lib/stock-enums";
import { Kpi } from "@/pages/distribution/RouteVisits";

// The van and the day, both in the URL. The first van is picked when none is.
function useVanAndDate(gridId: string) {
  const vans = (useWarehouses().data ?? []).filter((w) => w.isVan && w.isActive);
  const [van, setVan] = useUrlParam("van", "", [`${gridId}.page`]);
  const [date, setDate] = useUrlParam("date", isoToday(), [`${gridId}.page`]);
  useEffect(() => {
    if (!van && vans.length > 0) setVan(vans[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [van, vans.length]);
  return { vans, van, setVan, date, setDate };
}

function VanAndDate({ state, children }: { state: ReturnType<typeof useVanAndDate>; children?: ReactNode }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="van-pick">{t("dist.van")}</Label>
        <Select id="van-pick" className="w-56" value={state.van} onValueChange={state.setVan} placeholder={t("dist.van.pick")}
          options={state.vans.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="van-date">{t("dist.date")}</Label>
        <Input id="van-date" type="date" className="w-44" value={state.date} onChange={(e) => state.setDate(e.target.value)} />
      </div>
      {children}
    </div>
  );
}

const LOAD_GRID = "van-load";

// docs/POS_PLAN.md P6 — the morning load: what the confirmed orders of the day's route customers
// still wait for, less what is already on the van. "Create transfer" drafts the transfer from the
// main warehouse to the van for checking and posting.
export function VanLoad() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const state = useVanAndDate(LOAD_GRID);
  const sources = (useWarehouses().data ?? []).filter((w) => !w.isVan && w.isActive);
  const [from, setFrom] = useUrlParam("from", "");
  const source = from || sources.find((w) => w.isDefault)?.id || sources[0]?.id || "";
  const query = useQuery({
    queryKey: ["vanLoad", activeCompanyId, state.van, state.date],
    queryFn: () => apiClient.getVanLoad(activeCompanyId as string, state.van, state.date || undefined),
    enabled: !!activeCompanyId && !!state.van,
  });
  const lines = query.data ?? [];
  const toLoad = lines.filter((l) => l.toLoad > 0);

  const transfer = useMutation({
    mutationFn: () => apiClient.createStockDocument(activeCompanyId as string, {
      type: StockDocumentType.Transfer,
      date: state.date,
      warehouseId: source,
      destinationWarehouseId: state.van,
      notes: intl.formatMessage({ id: "dist.load.transferNote" }, { date: formatIsoDate(intl, state.date) }),
      lines: toLoad.map((l) => ({ itemId: l.itemId, quantity: l.toLoad })),
    }),
    onSuccess: (doc) => navigate(`/stock-documents/${doc.id}`),
  });

  const columns = useMemo<ColumnDef<VanLoadLineResponse>[]>(
    () => [
      { accessorKey: "itemCode", header: t("stock.col.code"), meta: { numeric: true } },
      { accessorKey: "itemName", header: t("stock.col.item") },
      { accessorKey: "unit", header: t("price.col.unit") },
      { accessorKey: "ordered", header: t("dist.load.ordered"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number) },
      { accessorKey: "onVan", header: t("dist.load.onVan"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number) },
      {
        accessorKey: "toLoad",
        header: t("dist.load.toLoad"),
        meta: { numeric: true },
        cell: ({ getValue }) => <span className={(getValue() as number) > 0 ? "font-semibold" : "text-muted-foreground"}>{intl.formatNumber(getValue() as number)}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("nav.vanLoad")}</CardTitle>
        <CardDescription>{t("nav.vanLoad.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.vans.length === 0 && <Alert><AlertDescription>{t("dist.van.none")}</AlertDescription></Alert>}
        <VanAndDate state={state}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="van-from">{t("dist.load.from")}</Label>
            <Select id="van-from" className="w-56" value={source} onValueChange={setFrom}
              options={sources.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
          </div>
          {canWrite("inventory") && (
            <Button size="sm" disabled={toLoad.length === 0 || !source || transfer.isPending} onClick={() => transfer.mutate()}>
              <ArrowLeftRight className="size-4" />
              {t("dist.load.createTransfer")}
            </Button>
          )}
        </VanAndDate>
        {transfer.error && <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(transfer.error, t("stock.doc.saveError"))}</AlertDescription></Alert>}
        <DataGrid
          gridId={LOAD_GRID}
          columns={columns}
          data={lines}
          rowCount={lines.length}
          isLoading={!!state.van && query.isPending}
          getRowId={(r) => r.itemId}
          enableGlobalFilter
          emptyMessage={t("dist.load.empty")}
          exportFileName="van-load"
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}

const SETTLEMENT_GRID = "van-settlement";

// docs/POS_PLAN.md P6 — the evening settlement: per item what the van started with, took on, sold,
// got back and unloaded, and the money the day brought. Every figure is the API's.
export function VanSettlement() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId, activeCompany } = useCompany();
  const state = useVanAndDate(SETTLEMENT_GRID);
  const printRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ["vanSettlement", activeCompanyId, state.van, state.date],
    queryFn: () => apiClient.getVanSettlement(activeCompanyId as string, state.van, state.date || undefined),
    enabled: !!activeCompanyId && !!state.van,
  });
  const settlement = query.data;
  const lines = settlement?.lines ?? [];
  const num = (v: number) => intl.formatNumber(v);

  const columns = useMemo<ColumnDef<VanSettlementLineResponse>[]>(
    () => [
      { accessorKey: "itemCode", header: t("stock.col.code"), meta: { numeric: true } },
      { accessorKey: "itemName", header: t("stock.col.item") },
      { accessorKey: "unit", header: t("price.col.unit") },
      ...(["opening", "loaded", "sold", "returned", "unloaded", "other", "closing"] as const).map((key): ColumnDef<VanSettlementLineResponse> => ({
        accessorKey: key,
        header: t(`dist.settle.${key}`),
        meta: { numeric: true },
        cell: ({ getValue }) => <span className={key === "closing" ? "font-semibold" : undefined}>{num(getValue() as number)}</span>,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("nav.vanSettlement")}</CardTitle>
          <CardDescription>{t("nav.vanSettlement.description")}</CardDescription>
        </div>
        {settlement && <PrintButton contentRef={printRef} size="sm" landscape />}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.vans.length === 0 && <Alert><AlertDescription>{t("dist.van.none")}</AlertDescription></Alert>}
        <VanAndDate state={state} />
        {query.isError && <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(query.error, t("dist.settle.loadError"))}</AlertDescription></Alert>}
        {settlement && <MoneyTiles settlement={settlement} />}
        <DataGrid
          gridId={SETTLEMENT_GRID}
          columns={columns}
          data={lines}
          rowCount={lines.length}
          isLoading={!!state.van && query.isPending}
          getRowId={(r) => r.itemId}
          enableGlobalFilter
          emptyMessage={t("dist.settle.empty")}
          exportFileName="van-settlement"
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
      {settlement && (
        <div className="sr-only" aria-hidden>
          <SettlementPrint ref={printRef} settlement={settlement} companyName={activeCompany?.name ?? ""} />
        </div>
      )}
    </Card>
  );
}

function MoneyTiles({ settlement }: { settlement: VanSettlementResponse }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label={t("dist.settle.invoiced")} value={formatAmount(settlement.invoiced)}
        hint={intl.formatMessage({ id: "dist.settle.invoiceCount" }, { count: settlement.invoices })} />
      <Kpi label={t("dist.settle.couponSales")} value={formatAmount(settlement.couponSales)}
        hint={intl.formatMessage({ id: "dist.settle.couponCount" }, { count: settlement.coupons })} />
      <Kpi label={t("dist.kpi.collected")} value={formatAmount(settlement.collected)} />
      <Kpi label={t("dist.kpi.visits")} value={intl.formatNumber(settlement.visits)} />
    </div>
  );
}

const SettlementPrint = ({ ref, settlement, companyName }: {
  ref: Ref<HTMLDivElement>; settlement: VanSettlementResponse; companyName: string;
}) => {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const num = (v: number) => intl.formatNumber(v);
  const keys = ["opening", "loaded", "sold", "returned", "unloaded", "other", "closing"] as const;
  return (
    <div ref={ref} className="flex flex-col gap-4 bg-white p-2 text-[11px] text-black">
      <header className="flex items-start justify-between border-b border-black pb-2">
        <p className="text-base font-bold">{companyName}</p>
        <div className="text-right">
          <p className="text-base font-bold">{t("nav.vanSettlement")}</p>
          <p>{settlement.warehouseName} · {formatIsoDate(intl, settlement.date)}</p>
        </div>
      </header>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">{t("stock.col.code")}</th>
            <th className="py-1">{t("stock.col.item")}</th>
            <th className="py-1">{t("price.col.unit")}</th>
            {keys.map((k) => <th key={k} className="py-1 text-right">{t(`dist.settle.${k}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {settlement.lines.map((l) => (
            <tr key={l.itemId} className="border-b border-neutral-300">
              <td className="py-1">{l.itemCode}</td>
              <td className="py-1">{l.itemName}</td>
              <td className="py-1">{l.unit}</td>
              {keys.map((k) => <td key={k} className="py-1 text-right tabular-nums">{num(l[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <section className="ml-auto flex w-72 flex-col gap-1">
        <div className="flex justify-between"><span>{t("dist.settle.invoiced")} ({settlement.invoices})</span><span className="tabular-nums">{formatAmount(settlement.invoiced)}</span></div>
        <div className="flex justify-between"><span>{t("dist.settle.couponSales")} ({settlement.coupons})</span><span className="tabular-nums">{formatAmount(settlement.couponSales)}</span></div>
        <div className="flex justify-between"><span>{t("dist.kpi.collected")}</span><span className="tabular-nums">{formatAmount(settlement.collected)}</span></div>
        <div className="flex justify-between"><span>{t("dist.kpi.visits")}</span><span className="tabular-nums">{settlement.visits}</span></div>
      </section>
      <footer className="mt-8 grid grid-cols-2 gap-10">
        <div className="border-t border-black pt-1 text-center">{t("dist.print.driver")}</div>
        <div className="border-t border-black pt-1 text-center">{t("dist.print.warehouse")}</div>
      </footer>
    </div>
  );
};
