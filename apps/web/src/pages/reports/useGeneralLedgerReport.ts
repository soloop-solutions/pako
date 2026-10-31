import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";

import { useClampPage } from "./useClampPage";
import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export const GENERAL_LEDGER_GRID_ID = "generalLedger";
export const GENERAL_LEDGER_SORTABLE = new Set(["date", "account", "debit", "credit"]);

export function useGeneralLedgerReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();
  const grid = useDataGridUrlState(GENERAL_LEDGER_GRID_ID, 50);
  const accountId = period.searchParams.get("accountId") || undefined;
  const partnerId = period.searchParams.get("partnerId") || undefined;
  const search = grid.globalFilter || undefined;
  const sort = grid.sort && GENERAL_LEDGER_SORTABLE.has(grid.sort.id) ? `${grid.sort.desc ? "-" : ""}${grid.sort.id}` : undefined;

  const query = useQuery({
    queryKey: ["reports", "generalLedger", companyId, period.from, period.to, accountId, partnerId, grid.page, grid.pageSize, search, sort] as const,
    queryFn: () =>
      apiClient.generalLedger(companyId as string, period.from, period.to, accountId, partnerId, grid.page, grid.pageSize, search, sort),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
  });

  useClampPage(grid, query.data?.total, !query.isPlaceholderData);

  const accounts = useQuery({
    queryKey: ["reports", "accounts", companyId] as const,
    queryFn: () => apiClient.accountsAll(companyId as string),
    enabled: enabled && !!companyId,
  });
  const partners = useQuery({
    queryKey: ["reports", "partners", companyId] as const,
    queryFn: () => apiClient.partnersAll(companyId as string),
    enabled: enabled && !!companyId,
  });

  const exporter = useReportExport(
    () => apiClient.generalLedgerExport(companyId as string, period.from, period.to, accountId, partnerId),
    "general-ledger.xlsx",
  );

  return {
    period,
    accountId,
    partnerId,
    accounts: accounts.data ?? [],
    partners: partners.data ?? [],
    data: query.data,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.glLoadError" })) : null,
    ...exporter,
  };
}
