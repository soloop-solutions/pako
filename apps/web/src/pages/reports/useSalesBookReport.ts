import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  SalesBookResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { downloadFileResponse, startOfMonth, today } from "./helpers";
import { useAutoRun } from "./useAutoRun";
import { useReportPeriod } from "./useReportPeriod";

export function useSalesBookReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const { searchParams, setParams } = useReportPeriod();
  const urlFrom = searchParams.get("from");
  const urlTo = searchParams.get("to");

  const [salesBookFrom, setSalesBookFrom] = useState(() => urlFrom || startOfMonth());
  const [salesBookTo, setSalesBookTo] = useState(() => urlTo || today());
  const [salesBook, setSalesBook] = useState<SalesBookResponse | null>(null);
  const [salesBookPeriod, setSalesBookPeriod] = useState<{ from: string; to: string } | null>(null);
  const [salesBookError, setSalesBookError] = useState<string | null>(null);
  const [salesBookLoading, setSalesBookLoading] = useState(false);
  const [salesBookExporting, setSalesBookExporting] = useState(false);

  const loadedKey = useAutoRun(enabled && !!companyId, urlFrom || urlTo ? `${urlFrom || startOfMonth()}|${urlTo || today()}` : null, applyUrl);

  function applyUrl() {
    const from = urlFrom || startOfMonth();
    const to = urlTo || today();
    setSalesBookFrom(from);
    setSalesBookTo(to);
    void fetchSalesBook(from, to);
  }

  function loadSalesBook() {
    setParams({ from: salesBookFrom, to: salesBookTo });
    return fetchSalesBook(salesBookFrom, salesBookTo);
  }

  async function fetchSalesBook(from: string, to: string) {
    if (!companyId) return;
    loadedKey.current = `${from}|${to}`;
    setSalesBookError(null);
    setSalesBookLoading(true);
    try {
      const result = await apiClient.salesBook(companyId, from, to);
      setSalesBook(result);
      setSalesBookPeriod({ from, to });
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
