import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";

import { today } from "./helpers";
import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function usePayablesAgingReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();
  const asOf = period.searchParams.get("asOf") || today();

  const query = useQuery({
    queryKey: ["reports", "payablesAging", companyId, asOf] as const,
    queryFn: () => apiClient.payablesAging(companyId as string, asOf),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
  });

  const exporter = useReportExport(() => apiClient.payablesAgingExport(companyId as string, asOf), "payables-aging.xlsx");

  return {
    asOf,
    setAsOf: (value: string) => period.setParam("asOf", value || null),
    data: query.data,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.payablesAgingLoadError" })) : null,
    ...exporter,
  };
}
