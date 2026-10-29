import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  BalanceSheetComparativeResponse,
  BalanceSheetResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { today } from "./helpers";
import { useReportExport } from "./useReportExport";

export function useBalanceSheetReport(companyId: string | null) {
  const intl = useIntl();

  const [asOf, setAsOf] = useState(today);
  const [compareTo, setCompareTo] = useState("");
  const [comparative, setComparative] = useState<BalanceSheetComparativeResponse | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetResponse | null>(null);
  const [balanceSheetAsOf, setBalanceSheetAsOf] = useState<string | null>(null);
  const [balanceSheetError, setBalanceSheetError] = useState<string | null>(null);
  const [balanceSheetLoading, setBalanceSheetLoading] = useState(false);

  async function loadBalanceSheet() {
    if (!companyId) return;
    setBalanceSheetError(null);
    setBalanceSheetLoading(true);
    try {
      if (compareTo) {
        const result = await apiClient.comparative(companyId, asOf, compareTo);
        setComparative(result);
        setBalanceSheet(null);
      } else {
        const result = await apiClient.balanceSheet(companyId, asOf);
        setBalanceSheet(result);
        setComparative(null);
      }
      setBalanceSheetAsOf(asOf);
    } catch (err) {
      setBalanceSheetError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.balanceSheetLoadError" })));
    } finally {
      setBalanceSheetLoading(false);
    }
  }

  const comparativeExporter = useReportExport(
    () => apiClient.balanceSheetComparativeExport(companyId as string, comparative?.asOf ?? asOf, comparative?.compareTo ?? compareTo),
    "balance-sheet-comparative.xlsx",
  );

  return { compareTo, setCompareTo, comparative, comparativeExporter, asOf, setAsOf, balanceSheet, balanceSheetAsOf, balanceSheetError, balanceSheetLoading, loadBalanceSheet };
}
