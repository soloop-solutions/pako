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

function parseDay(raw: string | null, fallback: number, length: number): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), length);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

  const monthLength = new Date(year, month, 0).getDate();
  const fromDay = parseDay(period.searchParams.get("fromDay"), 1, monthLength);
  const toDay = Math.max(parseDay(period.searchParams.get("toDay"), monthLength, monthLength), fromDay);
  const partialMonth = fromDay !== 1 || toDay !== monthLength;
  const from = partialMonth ? isoDate(year, month, fromDay) : undefined;
  const to = partialMonth ? isoDate(year, month, toDay) : undefined;

  const query = useQuery({
    queryKey: ["reports", "vatDeclaration", companyId, year, month, carriedCredit, refundRequested, from, to] as const,
    queryFn: () => apiClient.vatDeclaration(companyId as string, year, month, carriedCredit, refundRequested, from, to),
    enabled: enabled && !!companyId && !monthInvalid,
    placeholderData: keepPreviousData,
  });

  const [lastGood, setLastGood] = useState(query.data);
  if (query.data && query.data !== lastGood) setLastGood(query.data);

  const exporter = useReportExport(
    () => apiClient.vatDeclarationExport(companyId as string, year, month, carriedCredit, refundRequested, from, to),
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
    fromDay,
    toDay,
    monthLength,
    setMonth: (value: string) => period.setParams({ month: value, fromDay: null, toDay: null }),
    setFromDay: (value: string) => period.setParam("fromDay", value.trim() || null),
    setToDay: (value: string) => period.setParam("toDay", value.trim() || null),
    setCarriedCredit: (value: string) => period.setParam("carriedCredit", value.trim() || null),
    setRefundRequested: (value: string) => period.setParam("refundRequested", value.trim() || null),
    data: query.data ?? lastGood,
    loading: query.isFetching,
    error: query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.vatDeclLoadError" })) : null,
    ...exporter,
  };
}
