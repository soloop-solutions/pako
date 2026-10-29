import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  PurchaseBookResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { downloadFileResponse, startOfMonth, today } from "./helpers";

export function usePurchaseBookReport(companyId: string | null) {
  const intl = useIntl();

  const [purchaseBookFrom, setPurchaseBookFrom] = useState(startOfMonth);
  const [purchaseBookTo, setPurchaseBookTo] = useState(today);
  const [purchaseBook, setPurchaseBook] = useState<PurchaseBookResponse | null>(null);
  const [purchaseBookPeriod, setPurchaseBookPeriod] = useState<{ from: string; to: string } | null>(null);
  const [purchaseBookError, setPurchaseBookError] = useState<string | null>(null);
  const [purchaseBookLoading, setPurchaseBookLoading] = useState(false);
  const [purchaseBookExporting, setPurchaseBookExporting] = useState(false);

  async function loadPurchaseBook() {
    if (!companyId) return;
    setPurchaseBookError(null);
    setPurchaseBookLoading(true);
    try {
      const result = await apiClient.purchaseBook(companyId, purchaseBookFrom, purchaseBookTo);
      setPurchaseBook(result);
      setPurchaseBookPeriod({ from: purchaseBookFrom, to: purchaseBookTo });
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
