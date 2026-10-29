import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";

import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function useEquityStatementReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();

  const query = useQuery({
    queryKey: ["reports", "equityStatement", companyId, period.from, period.to] as const,
    queryFn: () => apiClient.equityStatement(companyId as string, period.from, period.to),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
  });

  const exporter = useReportExport(
    () => apiClient.equityStatementExport(companyId as string, period.from, period.to),
    "equity-statement.xlsx",
  );

  return {
    period,
    data: query.data,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.equityLoadError" })) : null,
    ...exporter,
  };
}
