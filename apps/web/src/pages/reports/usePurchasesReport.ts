import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";

import { useClampPage } from "./useClampPage";
import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export const PURCHASES_VIEWS = ["by-vendor", "by-item", "transactions"] as const;
export type PurchasesView = (typeof PURCHASES_VIEWS)[number];

export const PURCHASE_TRANSACTIONS_GRID_ID = "purchaseTransactions";
export const PURCHASE_TRANSACTIONS_SORTABLE = new Set(["date", "vendor", "document", "net", "gross"]);

export function usePurchasesReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();
  const grid = useDataGridUrlState(PURCHASE_TRANSACTIONS_GRID_ID, 50);
  const viewParam = period.searchParams.get("view");
  const view: PurchasesView = PURCHASES_VIEWS.find((v) => v === viewParam) ?? "by-vendor";
  const partnerId = period.searchParams.get("partnerId") || undefined;
  const search = grid.globalFilter || undefined;
  const sort = grid.sort && PURCHASE_TRANSACTIONS_SORTABLE.has(grid.sort.id) ? `${grid.sort.desc ? "-" : ""}${grid.sort.id}` : undefined;
  const active = enabled && !!companyId;

  const byVendor = useQuery({
    queryKey: ["reports", "purchasesByVendor", companyId, period.from, period.to] as const,
    queryFn: () => apiClient.purchasesByVendor(companyId as string, period.from, period.to),
    enabled: active && view === "by-vendor",
    placeholderData: keepPreviousData,
  });
  const byItem = useQuery({
    queryKey: ["reports", "purchasesByItem", companyId, period.from, period.to] as const,
    queryFn: () => apiClient.purchasesByItem(companyId as string, period.from, period.to),
    enabled: active && view === "by-item",
    placeholderData: keepPreviousData,
  });
  const transactions = useQuery({
    queryKey: ["reports", "purchaseTransactions", companyId, period.from, period.to, partnerId, grid.page, grid.pageSize, search, sort] as const,
    queryFn: () => apiClient.purchaseTransactions(companyId as string, period.from, period.to, partnerId, grid.page, grid.pageSize, search, sort),
    enabled: active && view === "transactions",
    placeholderData: keepPreviousData,
  });
  useClampPage(grid, transactions.data?.total, !transactions.isPlaceholderData);

  const partners = useQuery({
    queryKey: ["reports", "partners", companyId] as const,
    queryFn: () => apiClient.partnersAll(companyId as string),
    enabled: active && view === "transactions",
  });

  const exporter = useReportExport(() => {
    const id = companyId as string;
    if (view === "by-item") return apiClient.purchasesByItemExport(id, period.from, period.to);
    if (view === "transactions") return apiClient.purchaseTransactionsExport(id, period.from, period.to, partnerId);
    return apiClient.purchasesByVendorExport(id, period.from, period.to);
  }, `purchases-${view}.xlsx`);

  const failing = view === "by-item" ? byItem.error : view === "transactions" ? transactions.error : byVendor.error;
  const current = view === "by-item" ? byItem : view === "transactions" ? transactions : byVendor;

  return {
    period,
    view,
    setView: (next: PurchasesView) => period.setParam("view", next),
    partnerId,
    partners: partners.data ?? [],
    byVendor: byVendor.data,
    byItem: byItem.data,
    transactions: transactions.data,
    loading: current.isFetching,
    error: failing ? getApiErrorMessage(failing, intl.formatMessage({ id: "reports.purchasesLoadError" })) : null,
    ...exporter,
  };
}
