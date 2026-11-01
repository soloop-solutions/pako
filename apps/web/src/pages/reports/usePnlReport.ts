import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  ProfitAndLossResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { startOfMonth, today } from "./helpers";
import { useAutoRun } from "./useAutoRun";
import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function usePnlReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const { searchParams, setParams } = useReportPeriod();
  const urlFrom = searchParams.get("from");
  const urlTo = searchParams.get("to");

  const [pnlFrom, setPnlFrom] = useState(() => urlFrom || startOfMonth());
  const [pnlTo, setPnlTo] = useState(() => urlTo || today());
  const [pnl, setPnl] = useState<ProfitAndLossResponse | null>(null);
  // The period the currently-displayed `pnl` was actually loaded for — set only on a successful
  // load, never from the live `pnlFrom`/`pnlTo` inputs. The lock badge and the exported file must
  // describe what's on screen, not an edited-but-not-yet-submitted date range; see the same pattern
  // on balanceSheetPeriod/vatPeriod/debtPeriod below.
  const [pnlPeriod, setPnlPeriod] = useState<{ from: string; to: string } | null>(null);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [pnlLoading, setPnlLoading] = useState(false);

  const loadedKey = useAutoRun(enabled && !!companyId, urlFrom || urlTo ? `${urlFrom || startOfMonth()}|${urlTo || today()}` : null, applyUrl);

  function applyUrl() {
    const from = urlFrom || startOfMonth();
    const to = urlTo || today();
    setPnlFrom(from);
    setPnlTo(to);
    void fetchPnl(from, to);
  }

  function loadPnl() {
    setParams({ from: pnlFrom, to: pnlTo });
    return fetchPnl(pnlFrom, pnlTo);
  }

  async function fetchPnl(from: string, to: string) {
    if (!companyId) return;
    loadedKey.current = `${from}|${to}`;
    setPnlError(null);
    setPnlLoading(true);
    try {
      const result = await apiClient.profitAndLoss(companyId, from, to);
      setPnl(result);
      setPnlPeriod({ from, to });
    } catch (err) {
      setPnlError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.pnlLoadError" })));
    } finally {
      setPnlLoading(false);
    }
  }

  const exporter = useReportExport(
    () => apiClient.profitAndLossExport(companyId as string, pnlFrom, pnlTo),
    `profit-and-loss_${pnlFrom}_${pnlTo}.xlsx`,
  );

  return { pnlFrom, setPnlFrom, pnlTo, setPnlTo, pnl, pnlPeriod, pnlError, pnlLoading, loadPnl, exporter };
}
