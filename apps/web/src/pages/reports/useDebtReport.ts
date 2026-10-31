import { useState } from "react";
import { useIntl } from "react-intl";

import type {
  DebtAgingResponse,
  PartnerResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { today } from "./helpers";
import { useAutoRun } from "./useAutoRun";
import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export function useDebtReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const { searchParams, setParams } = useReportPeriod();
  const urlAsOf = searchParams.get("asOf") || searchParams.get("to");

  const [debtAsOf, setDebtAsOf] = useState(() => urlAsOf || today());
  const [debtAging, setDebtAging] = useState<DebtAgingResponse | null>(null);
  const [debtAsOfLoaded, setDebtAsOfLoaded] = useState<string | null>(null);
  const [debtPartners, setDebtPartners] = useState<PartnerResponse[]>([]);
  const [debtError, setDebtError] = useState<string | null>(null);
  const [debtLoading, setDebtLoading] = useState(false);

  const loadedKey = useAutoRun(enabled && !!companyId, urlAsOf, applyUrl);

  function applyUrl() {
    const asOf = urlAsOf || today();
    setDebtAsOf(asOf);
    void fetchDebtAging(asOf);
  }

  function loadDebtAging() {
    setParams({ asOf: debtAsOf });
    return fetchDebtAging(debtAsOf);
  }

  async function fetchDebtAging(asOf: string) {
    if (!companyId) return;
    loadedKey.current = asOf;
    setDebtError(null);
    setDebtLoading(true);
    try {
      const [debtAgingResult, partnersResult] = await Promise.all([
        apiClient.debtAging(companyId, asOf),
        apiClient.partnersAll(companyId),
      ]);
      setDebtAging(debtAgingResult);
      setDebtAsOfLoaded(asOf);
      setDebtPartners(partnersResult);
    } catch (err) {
      setDebtError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.debtAgingLoadError" })));
    } finally {
      setDebtLoading(false);
    }
  }

  function debtPartnerName(partnerId: string) {
    return debtPartners.find((p) => p.id === partnerId)?.name ?? partnerId;
  }

  const exporter = useReportExport(
    () => apiClient.debtAgingExport(companyId as string, debtAsOfLoaded as string),
    `debt-aging_${debtAsOfLoaded}.xlsx`,
  );

  return { exporter, debtAsOf, setDebtAsOf, debtAging, debtAsOfLoaded, debtError, debtLoading, loadDebtAging, debtPartnerName };
}
