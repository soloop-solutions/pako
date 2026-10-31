import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";

import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function isValidMonth(raw: string | null): boolean {
  const parsed = Number(raw);
  return !!raw && Number.isInteger(parsed) && parsed >= 1 && parsed <= 12;
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
  const monthRaw = period.searchParams.get("month");
  const monthInvalid = monthRaw !== null && !isValidMonth(monthRaw);
  const month = monthRaw !== null && !monthInvalid ? Number(monthRaw) : new Date().getMonth() + 1;
  const carriedCredit = parseOptionalAmount(period.searchParams.get("carriedCredit"));
  const refundRequested = parseOptionalAmount(period.searchParams.get("refundRequested"));

  const query = useQuery({
    queryKey: ["reports", "vatDeclaration", companyId, year, month, carriedCredit, refundRequested] as const,
    queryFn: () => apiClient.vatDeclaration(companyId as string, year, month, carriedCredit, refundRequested),
    enabled: enabled && !!companyId && !monthInvalid,
    placeholderData: keepPreviousData,
  });

  const [lastGood, setLastGood] = useState(query.data);
  if (query.data && query.data !== lastGood) setLastGood(query.data);

  const exporter = useReportExport(
    () => apiClient.vatDeclarationExport(companyId as string, year, month, carriedCredit, refundRequested),
    `vat-declaration-${year}-${String(month).padStart(2, "0")}.xlsx`,
  );

  return {
    period,
    year,
    month,
    monthRaw,
    monthInvalid,
    carriedCredit,
    refundRequested,
    setMonth: (value: string) => period.setParam("month", value),
    setCarriedCredit: (value: string) => period.setParam("carriedCredit", value.trim() || null),
    setRefundRequested: (value: string) => period.setParam("refundRequested", value.trim() || null),
    data: query.data ?? lastGood,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.vatDeclLoadError" })) : null,
    ...exporter,
  };
}
