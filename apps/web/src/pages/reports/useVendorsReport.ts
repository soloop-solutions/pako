import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";

import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function useVendorsReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();
  const includeZero = period.searchParams.get("includeZero") === "1";
  const vendorId = period.searchParams.get("vendor") || undefined;

  const query = useQuery({
    queryKey: ["reports", "vendors", companyId, period.from, period.to, includeZero] as const,
    queryFn: () => apiClient.vendorSynthetic(companyId as string, period.from, period.to, includeZero),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
  });

  const exporter = useReportExport(
    () => apiClient.vendorSyntheticExport(companyId as string, period.from, period.to, includeZero),
    "vendors.xlsx",
  );

  return {
    period,
    includeZero,
    setIncludeZero: (value: boolean) => period.setParam("includeZero", value ? "1" : null),
    vendorId,
    openVendor: (partnerId: string) => period.setParam("vendor", partnerId),
    closeVendor: () => period.setParam("vendor", null),
    data: query.data,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.vendorsLoadError" })) : null,
    ...exporter,
  };
}
