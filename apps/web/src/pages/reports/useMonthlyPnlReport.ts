import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";

import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function useMonthlyPnlReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();

  const query = useQuery({
    queryKey: ["reports", "monthlyPnl", companyId, period.year] as const,
    queryFn: () => apiClient.monthly(companyId as string, period.year),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
  });

  const exporter = useReportExport(
    () => apiClient.monthlyProfitAndLossExport(companyId as string, period.year),
    "monthly-profit-and-loss.xlsx",
  );

  return {
    period,
    data: query.data,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.monthlyPnlLoadError" })) : null,
    ...exporter,
  };
}
