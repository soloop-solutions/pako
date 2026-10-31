import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";

import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

function parseMonth(raw: string | null): number {
  const parsed = Number(raw);
  return raw && Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : new Date().getMonth() + 1;
}

function parseOptionalAmount(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function useVatDeclarationReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();
  const year = period.year;
  const month = parseMonth(period.searchParams.get("month"));
  const carriedCredit = parseOptionalAmount(period.searchParams.get("carriedCredit"));
  const refundRequested = parseOptionalAmount(period.searchParams.get("refundRequested"));

  const query = useQuery({
    queryKey: ["reports", "vatDeclaration", companyId, year, month, carriedCredit, refundRequested] as const,
    queryFn: () => apiClient.vatDeclaration(companyId as string, year, month, carriedCredit, refundRequested),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
  });

  const exporter = useReportExport(
    () => apiClient.vatDeclarationExport(companyId as string, year, month, carriedCredit, refundRequested),
    `vat-declaration-${year}-${String(month).padStart(2, "0")}.xlsx`,
  );

  return {
    period,
    year,
    month,
    carriedCredit,
    refundRequested,
    setMonth: (value: string) => period.setParam("month", value),
    setCarriedCredit: (value: string) => period.setParam("carriedCredit", value.trim() || null),
    setRefundRequested: (value: string) => period.setParam("refundRequested", value.trim() || null),
    data: query.data,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.vatDeclLoadError" })) : null,
    ...exporter,
  };
}
