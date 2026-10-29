import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  SalesBookResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { downloadFileResponse, startOfMonth, today } from "./helpers";

export function useSalesBookReport(companyId: string | null) {
  const intl = useIntl();

  const [salesBookFrom, setSalesBookFrom] = useState(startOfMonth);
  const [salesBookTo, setSalesBookTo] = useState(today);
  const [salesBook, setSalesBook] = useState<SalesBookResponse | null>(null);
  const [salesBookPeriod, setSalesBookPeriod] = useState<{ from: string; to: string } | null>(null);
  const [salesBookError, setSalesBookError] = useState<string | null>(null);
  const [salesBookLoading, setSalesBookLoading] = useState(false);
  const [salesBookExporting, setSalesBookExporting] = useState(false);

  async function loadSalesBook() {
    if (!companyId) return;
    setSalesBookError(null);
    setSalesBookLoading(true);
    try {
      const result = await apiClient.salesBook(companyId, salesBookFrom, salesBookTo);
      setSalesBook(result);
      setSalesBookPeriod({ from: salesBookFrom, to: salesBookTo });
    } catch (err) {
      setSalesBookError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.salesBookLoadError" })));
    } finally {
      setSalesBookLoading(false);
    }
  }

  async function exportSalesBook() {
    if (!companyId || !salesBookPeriod) return;
    setSalesBookError(null);
    setSalesBookExporting(true);
    try {
      const file = await apiClient.salesBookExport(companyId, salesBookPeriod.from, salesBookPeriod.to);
      downloadFileResponse(file, `sales-book-${salesBookPeriod.from}_${salesBookPeriod.to}.xlsx`);
    } catch (err) {
      setSalesBookError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.salesBookLoadError" })));
    } finally {
      setSalesBookExporting(false);
    }
  }

  return { salesBookFrom, setSalesBookFrom, salesBookTo, setSalesBookTo, salesBook, salesBookPeriod, salesBookError, salesBookLoading, salesBookExporting, loadSalesBook, exportSalesBook };
}
