import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  VatReturnResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { startOfMonth, today } from "./helpers";
import { useAutoRun } from "./useAutoRun";
import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function useVatReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const { searchParams, setParams } = useReportPeriod();
  const urlFrom = searchParams.get("from");
  const urlTo = searchParams.get("to");

  const [vatFrom, setVatFrom] = useState(() => urlFrom || startOfMonth());
  const [vatTo, setVatTo] = useState(() => urlTo || today());
  const [vatReturn, setVatReturn] = useState<VatReturnResponse | null>(null);
  const [vatPeriod, setVatPeriod] = useState<{ from: string; to: string } | null>(null);
  const [vatError, setVatError] = useState<string | null>(null);
  const [vatLoading, setVatLoading] = useState(false);

  const loadedKey = useAutoRun(enabled && !!companyId, urlFrom || urlTo ? `${urlFrom || startOfMonth()}|${urlTo || today()}` : null, applyUrl);

  function applyUrl() {
    const from = urlFrom || startOfMonth();
    const to = urlTo || today();
    setVatFrom(from);
    setVatTo(to);
    void fetchVatReturn(from, to);
  }

  function loadVatReturn() {
    setParams({ from: vatFrom, to: vatTo });
    return fetchVatReturn(vatFrom, vatTo);
  }

  async function fetchVatReturn(from: string, to: string) {
    if (!companyId) return;
    loadedKey.current = `${from}|${to}`;
    setVatError(null);
    setVatLoading(true);
    try {
      const result = await apiClient.vatReturn(companyId, from, to);
      setVatReturn(result);
      setVatPeriod({ from, to });
    } catch (err) {
      setVatError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.vatLoadError" })));
    } finally {
      setVatLoading(false);
    }
  }

  const exporter = useReportExport(
    () => apiClient.vatReturnExport(companyId as string, vatFrom, vatTo),
    `vat-return_${vatFrom}_${vatTo}.xlsx`,
  );

  return { vatFrom, setVatFrom, vatTo, setVatTo, vatReturn, vatPeriod, vatError, vatLoading, loadVatReturn, exporter };
}
