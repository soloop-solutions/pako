import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";

import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function useCashFlowReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();

  const query = useQuery({
    queryKey: ["reports", "cashFlow", companyId, period.from, period.to] as const,
    queryFn: () => apiClient.cashFlow(companyId as string, period.from, period.to),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
  });

  const exporter = useReportExport(
    () => apiClient.cashFlowExport(companyId as string, period.from, period.to),
    "cash-flow.xlsx",
  );

  return {
    period,
    data: query.data,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.cashFlowLoadError" })) : null,
    ...exporter,
  };
}
