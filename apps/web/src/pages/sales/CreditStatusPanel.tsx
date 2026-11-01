import type { CreditStatusResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { Badge } from "@/components/ui/badge";
import { useCreditStatus } from "@/hooks/useDistribution";
import { formatAmount } from "@/lib/payroll-enums";
import { cn } from "@/lib/utils";

// docs/POS_PLAN.md P6 — a customer's credit: limit, what they owe, open orders, what's left and
// overdue invoices. Display only: every figure is the API's.
export function CreditStatusPanel({ partnerId, className }: { partnerId: string | undefined; className?: string }) {
  const intl = useIntl();
  const query = useCreditStatus(partnerId);
  if (!partnerId) return null;
  if (query.isPending) return <p className={cn("text-xs text-muted-foreground", className)}>{intl.formatMessage({ id: "platform.loading" })}</p>;
  if (!query.data) return null;
  return <CreditStatusView status={query.data} className={className} />;
}

export function CreditStatusView({ status, className }: { status: CreditStatusResponse; className?: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const overLimit = status.available != null && status.available < 0;
  const row = (label: string, value: string, tone?: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tnum text-right", tone)}>{value}</dd>
    </div>
  );
  return (
    <section className={cn("flex flex-col gap-2 rounded-md border p-3 text-sm", className)} aria-label={t("dist.credit.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("dist.credit.title")}</h3>
        <div className="flex flex-wrap gap-1">
          {status.overdueBlocked && <Badge variant="destructive">{t("dist.credit.blocked")}</Badge>}
          {overLimit && <Badge variant="warning">{t("dist.credit.overLimit")}</Badge>}
          {!status.overdueBlocked && !overLimit && <Badge variant="success">{t("dist.credit.ok")}</Badge>}
        </div>
      </div>
      <dl className="flex flex-col gap-1">
        {row(t("dist.credit.limit"), status.creditLimit == null ? t("dist.credit.noLimit") : formatAmount(status.creditLimit))}
        {row(t("dist.credit.outstanding"), formatAmount(status.outstanding))}
        {row(t("dist.credit.openOrders"), formatAmount(status.openOrders))}
        {status.available != null && row(t("dist.credit.available"), formatAmount(status.available), overLimit ? "font-semibold text-destructive" : undefined)}
        {row(t("dist.credit.overdue"), formatAmount(status.overdue), status.overdue > 0 ? "font-semibold text-destructive" : undefined)}
        {status.overdue > 0 && row(t("dist.credit.oldestOverdue"), t("dist.credit.days", { days: status.oldestOverdueDays }))}
        {row(t("dist.credit.blockAfter"), status.overdueBlockDays == null ? t("dist.credit.noBlock") : t("dist.credit.days", { days: status.overdueBlockDays }))}
      </dl>
    </section>
  );
}
