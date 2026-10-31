import { useState } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";

import type {
  DebtAgingResponse,
  PartnerResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { today } from "./helpers";

export function useDebtReport(companyId: string | null) {
  const intl = useIntl();
  const [searchParams] = useSearchParams();

  const [debtAsOf, setDebtAsOf] = useState(() => searchParams.get("asOf") || searchParams.get("to") || today());
  const [debtAging, setDebtAging] = useState<DebtAgingResponse | null>(null);
  const [debtAsOfLoaded, setDebtAsOfLoaded] = useState<string | null>(null);
  const [debtPartners, setDebtPartners] = useState<PartnerResponse[]>([]);
  const [debtError, setDebtError] = useState<string | null>(null);
  const [debtLoading, setDebtLoading] = useState(false);

  async function loadDebtAging() {
    if (!companyId) return;
    setDebtError(null);
    setDebtLoading(true);
    try {
      const [debtAgingResult, partnersResult] = await Promise.all([
        apiClient.debtAging(companyId, debtAsOf),
        apiClient.partnersAll(companyId),
      ]);
      setDebtAging(debtAgingResult);
      setDebtAsOfLoaded(debtAsOf);
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

  return { debtAsOf, setDebtAsOf, debtAging, debtAsOfLoaded, debtError, debtLoading, loadDebtAging, debtPartnerName };
}
