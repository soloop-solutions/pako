import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";

import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function useExpenseBookReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();

  const query = useQuery({
    queryKey: ["reports", "expenseBook", companyId, period.from, period.to] as const,
    queryFn: () => apiClient.expenseBook(companyId as string, period.from, period.to),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
  });

  const exporter = useReportExport(
    () => apiClient.expenseBookExport(companyId as string, period.from, period.to),
    "expense-book.xlsx",
  );

  return {
    period,
    data: query.data,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.expenseBookLoadError" })) : null,
    ...exporter,
  };
}
