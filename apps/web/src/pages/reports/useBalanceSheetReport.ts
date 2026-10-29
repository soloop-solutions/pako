import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  BalanceSheetResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { today } from "./helpers";

export function useBalanceSheetReport(companyId: string | null) {
  const intl = useIntl();

  const [asOf, setAsOf] = useState(today);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetResponse | null>(null);
  const [balanceSheetAsOf, setBalanceSheetAsOf] = useState<string | null>(null);
  const [balanceSheetError, setBalanceSheetError] = useState<string | null>(null);
  const [balanceSheetLoading, setBalanceSheetLoading] = useState(false);

  async function loadBalanceSheet() {
    if (!companyId) return;
    setBalanceSheetError(null);
    setBalanceSheetLoading(true);
    try {
      const result = await apiClient.balanceSheet(companyId, asOf);
      setBalanceSheet(result);
      setBalanceSheetAsOf(asOf);
    } catch (err) {
      setBalanceSheetError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.balanceSheetLoadError" })));
    } finally {
      setBalanceSheetLoading(false);
    }
  }

  return { asOf, setAsOf, balanceSheet, balanceSheetAsOf, balanceSheetError, balanceSheetLoading, loadBalanceSheet };
}
