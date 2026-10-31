import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCompany } from "@/context/CompanyContext";
import { formatAmount } from "@/lib/payroll-enums";

// docs/INVENTORY_PLAN.md phase 2: at year end, every warehouse that held stock needs a posted
// count dated in the year, and stock should agree with the ledger on 31 December.
export function YearEndStockCheck({ year }: { year: number }) {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const query = useQuery({
    queryKey: ["stockYearEndCheck", activeCompanyId, year],
    queryFn: () => apiClient.getStockYearEndCheck(activeCompanyId as string, year),
    enabled: !!activeCompanyId,
  });
  const check = query.data;
  if (!check || !check.tracksStock) return null;
  const missing = check.warehousesWithoutCount;
  const ok = missing.length === 0 && check.difference === 0;

  return (
    <Alert className={ok ? undefined : "border-warning-border bg-warning text-warning-foreground"}>
      <AlertDescription className="flex flex-col gap-1">
        <span className="flex items-center gap-2 font-medium">
          {ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          {intl.formatMessage({ id: "stock.yearEnd.title" }, { year })}
        </span>
        {missing.length > 0 ? (
          <span>{intl.formatMessage({ id: "stock.yearEnd.missingCount" }, { year, warehouses: missing.join(", ") })}</span>
        ) : (
          <span>
            {intl.formatMessage({ id: "stock.yearEnd.counted" }, {
              counts: check.warehouses.map((w) => `${w.warehouseName}: ${w.lastCountNumber ?? ""}`).join(" · "),
            })}
          </span>
        )}
        {check.difference !== 0 ? (
          <span>
            {intl.formatMessage({ id: "stock.yearEnd.difference" }, {
              stock: formatAmount(check.stockValue), ledger: formatAmount(check.ledgerValue), difference: formatAmount(check.difference),
            })}
          </span>
        ) : (
          <span>{intl.formatMessage({ id: "stock.yearEnd.tiesOut" }, { value: formatAmount(check.stockValue) })}</span>
        )}
      </AlertDescription>
    </Alert>
  );
}
