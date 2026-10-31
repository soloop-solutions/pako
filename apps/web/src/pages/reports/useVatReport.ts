import { useState } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";

import type {
  VatReturnResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { startOfMonth, today } from "./helpers";
import { useReportExport } from "./useReportExport";

export function useVatReport(companyId: string | null) {
  const intl = useIntl();
  const [searchParams] = useSearchParams();

  const [vatFrom, setVatFrom] = useState(() => searchParams.get("from") || startOfMonth());
  const [vatTo, setVatTo] = useState(() => searchParams.get("to") || today());
  const [vatReturn, setVatReturn] = useState<VatReturnResponse | null>(null);
  const [vatPeriod, setVatPeriod] = useState<{ from: string; to: string } | null>(null);
  const [vatError, setVatError] = useState<string | null>(null);
  const [vatLoading, setVatLoading] = useState(false);

  async function loadVatReturn() {
    if (!companyId) return;
    setVatError(null);
    setVatLoading(true);
    try {
      const result = await apiClient.vatReturn(companyId, vatFrom, vatTo);
      setVatReturn(result);
      setVatPeriod({ from: vatFrom, to: vatTo });
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
