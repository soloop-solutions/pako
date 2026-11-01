import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  BalanceSheetComparativeResponse,
  BalanceSheetResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { today } from "./helpers";
import { useAutoRun } from "./useAutoRun";
import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function useBalanceSheetReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const { searchParams, setParams } = useReportPeriod();
  const urlAsOf = searchParams.get("asOf") || searchParams.get("to");
  const urlCompareTo = searchParams.get("compareTo") || "";

  const [asOf, setAsOf] = useState(() => urlAsOf || today());
  const [compareTo, setCompareTo] = useState(urlCompareTo);
  const [comparative, setComparative] = useState<BalanceSheetComparativeResponse | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetResponse | null>(null);
  const [balanceSheetAsOf, setBalanceSheetAsOf] = useState<string | null>(null);
  const [balanceSheetError, setBalanceSheetError] = useState<string | null>(null);
  const [balanceSheetLoading, setBalanceSheetLoading] = useState(false);

  const loadedKey = useAutoRun(enabled && !!companyId, urlAsOf ? `${urlAsOf}|${urlCompareTo}` : null, applyUrl);

  function applyUrl() {
    const nextAsOf = urlAsOf || today();
    setAsOf(nextAsOf);
    setCompareTo(urlCompareTo);
    void fetchBalanceSheet(nextAsOf, urlCompareTo);
  }

  function loadBalanceSheet() {
    setParams({ asOf, compareTo: compareTo || null });
    return fetchBalanceSheet(asOf, compareTo);
  }

  async function fetchBalanceSheet(asOfDate: string, compareDate: string) {
    if (!companyId) return;
    loadedKey.current = `${asOfDate}|${compareDate}`;
    setBalanceSheetError(null);
    setBalanceSheetLoading(true);
    try {
      if (compareDate) {
        const result = await apiClient.comparative(companyId, asOfDate, compareDate);
        setComparative(result);
        setBalanceSheet(null);
      } else {
        const result = await apiClient.balanceSheet(companyId, asOfDate);
        setBalanceSheet(result);
        setComparative(null);
      }
      setBalanceSheetAsOf(asOfDate);
    } catch (err) {
      setBalanceSheetError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.balanceSheetLoadError" })));
    } finally {
      setBalanceSheetLoading(false);
    }
  }

  const exporter = useReportExport(
    () =>
      compareTo
        ? apiClient.balanceSheetComparativeExport(companyId as string, asOf, compareTo)
        : apiClient.balanceSheetExport(companyId as string, asOf),
    compareTo ? `balance-sheet-comparative_${asOf}.xlsx` : `balance-sheet_${asOf}.xlsx`,
  );

  return { compareTo, setCompareTo, comparative, exporter, asOf, setAsOf, balanceSheet, balanceSheetAsOf, balanceSheetError, balanceSheetLoading, loadBalanceSheet };
}
