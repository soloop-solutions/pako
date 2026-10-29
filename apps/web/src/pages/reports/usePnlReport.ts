import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  ProfitAndLossResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { startOfMonth, today } from "./helpers";

export function usePnlReport(companyId: string | null) {
  const intl = useIntl();

  const [pnlFrom, setPnlFrom] = useState(startOfMonth);
  const [pnlTo, setPnlTo] = useState(today);
  const [pnl, setPnl] = useState<ProfitAndLossResponse | null>(null);
  // The period the currently-displayed `pnl` was actually loaded for — set only on a successful
  // load, never from the live `pnlFrom`/`pnlTo` inputs. The lock badge and the exported file must
  // describe what's on screen, not an edited-but-not-yet-submitted date range; see the same pattern
  // on balanceSheetPeriod/vatPeriod/debtPeriod below.
  const [pnlPeriod, setPnlPeriod] = useState<{ from: string; to: string } | null>(null);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [pnlLoading, setPnlLoading] = useState(false);

  async function loadPnl() {
    if (!companyId) return;
    setPnlError(null);
    setPnlLoading(true);
    try {
      const result = await apiClient.profitAndLoss(companyId, pnlFrom, pnlTo);
      setPnl(result);
      setPnlPeriod({ from: pnlFrom, to: pnlTo });
    } catch (err) {
      setPnlError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.pnlLoadError" })));
    } finally {
      setPnlLoading(false);
    }
  }

  return { pnlFrom, setPnlFrom, pnlTo, setPnlTo, pnl, pnlPeriod, pnlError, pnlLoading, loadPnl };
}
