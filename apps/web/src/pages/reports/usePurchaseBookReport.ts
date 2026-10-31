import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  PurchaseBookResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { downloadFileResponse, startOfMonth, today } from "./helpers";
import { useAutoRun } from "./useAutoRun";
import { useReportPeriod } from "./useReportPeriod";

export function usePurchaseBookReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const { searchParams, setParams } = useReportPeriod();
  const urlFrom = searchParams.get("from");
  const urlTo = searchParams.get("to");

  const [purchaseBookFrom, setPurchaseBookFrom] = useState(() => urlFrom || startOfMonth());
  const [purchaseBookTo, setPurchaseBookTo] = useState(() => urlTo || today());
  const [purchaseBook, setPurchaseBook] = useState<PurchaseBookResponse | null>(null);
  const [purchaseBookPeriod, setPurchaseBookPeriod] = useState<{ from: string; to: string } | null>(null);
  const [purchaseBookError, setPurchaseBookError] = useState<string | null>(null);
  const [purchaseBookLoading, setPurchaseBookLoading] = useState(false);
  const [purchaseBookExporting, setPurchaseBookExporting] = useState(false);

  const loadedKey = useAutoRun(enabled && !!companyId, urlFrom || urlTo ? `${urlFrom || startOfMonth()}|${urlTo || today()}` : null, applyUrl);

  function applyUrl() {
    const from = urlFrom || startOfMonth();
    const to = urlTo || today();
    setPurchaseBookFrom(from);
    setPurchaseBookTo(to);
    void fetchPurchaseBook(from, to);
  }

  function loadPurchaseBook() {
    setParams({ from: purchaseBookFrom, to: purchaseBookTo });
    return fetchPurchaseBook(purchaseBookFrom, purchaseBookTo);
  }

  async function fetchPurchaseBook(from: string, to: string) {
    if (!companyId) return;
    loadedKey.current = `${from}|${to}`;
    setPurchaseBookError(null);
    setPurchaseBookLoading(true);
    try {
      const result = await apiClient.purchaseBook(companyId, from, to);
      setPurchaseBook(result);
      setPurchaseBookPeriod({ from, to });
    } catch (err) {
      setPurchaseBookError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.purchaseBookLoadError" })));
    } finally {
      setPurchaseBookLoading(false);
    }
  }

  async function exportPurchaseBook() {
    if (!companyId || !purchaseBookPeriod) return;
    setPurchaseBookError(null);
    setPurchaseBookExporting(true);
    try {
      const file = await apiClient.purchaseBookExport(companyId, purchaseBookPeriod.from, purchaseBookPeriod.to);
      downloadFileResponse(file, `purchase-book-${purchaseBookPeriod.from}_${purchaseBookPeriod.to}.xlsx`);
    } catch (err) {
      setPurchaseBookError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.purchaseBookLoadError" })));
    } finally {
      setPurchaseBookExporting(false);
    }
  }

  return { purchaseBookFrom, setPurchaseBookFrom, purchaseBookTo, setPurchaseBookTo, purchaseBook, purchaseBookPeriod, purchaseBookError, purchaseBookLoading, purchaseBookExporting, loadPurchaseBook, exportPurchaseBook };
}
