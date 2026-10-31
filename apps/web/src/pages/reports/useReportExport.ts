import { useState } from "react";
import { useIntl } from "react-intl";
import type { FileResponse } from "@pako/shared";

import { getApiErrorMessage } from "@/api/client";

import { downloadFileResponse } from "./helpers";

export function useReportExport(run: () => Promise<FileResponse>, fallbackFileName: string) {
  const intl = useIntl();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportFile() {
    setExportError(null);
    setExporting(true);
    try {
      downloadFileResponse(await run(), fallbackFileName);
    } catch (err) {
      setExportError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.exportError" })));
    } finally {
      setExporting(false);
    }
  }

  return { exportFile, exporting, exportError };
}
