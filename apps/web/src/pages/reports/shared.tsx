import { Link } from "react-router-dom";
import { useIntl } from "react-intl";
import { Download, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatReportAmount } from "@/lib/amount";

export function LockNotice({ lockDate, messageId }: { lockDate: string; messageId: "reports.periodLockedAccounting" | "reports.periodLockedTax" }) {
  const intl = useIntl();
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="w-fit gap-1 text-warning-foreground">
        <Lock className="size-3" />
        {intl.formatMessage({ id: "reports.lockBadge" })}
      </Badge>
      <span className="text-xs text-warning-foreground">{intl.formatMessage({ id: messageId }, { date: lockDate })}</span>
    </div>
  );
}

export function ExportButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  const intl = useIntl();
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={loading}>
      <Download className="size-3.5" />
      {loading ? intl.formatMessage({ id: "reports.exportingReport" }) : intl.formatMessage({ id: "reports.exportToExcel" })}
    </Button>
  );
}

/**
 * Renders a report amount; a non-zero value links to its source. With an account and the report's
 * period (UI/UX round 2026-11-24) it opens the general ledger for that account and period, whose
 * rows open the documents; otherwise the trial balance filtered by account code.
 */
export function DrillAmount({ amount, accountCode, accountId, period }: {
  amount: number;
  accountCode: string;
  accountId?: string;
  period?: { from: string; to: string } | null;
}) {
  const formatted = formatReportAmount(amount);
  if (amount === 0) return <>{formatted}</>;
  const target = accountId && period
    ? `/reports?tab=general-ledger&accountId=${encodeURIComponent(accountId)}&from=${period.from}&to=${period.to}`
    : `/ledger?trialBalance.q=${encodeURIComponent(accountCode)}`;
  return (
    <Link
      to={target}
      className="cursor-pointer text-primary hover:underline"
    >
      {formatted}
    </Link>
  );
}
