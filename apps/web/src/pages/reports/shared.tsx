import { Link } from "react-router-dom";
import { useIntl } from "react-intl";
import { Download, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function LockNotice({ lockDate, messageId }: { lockDate: string; messageId: "reports.periodLockedAccounting" | "reports.periodLockedTax" }) {
  const intl = useIntl();
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="w-fit gap-1 text-amber-600">
        <Lock className="size-3" />
        {intl.formatMessage({ id: "reports.lockBadge" })}
      </Badge>
      <span className="text-xs text-amber-600">{intl.formatMessage({ id: messageId }, { date: lockDate })}</span>
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

/** Renders a report amount; non-zero values link to the trial balance filtered by account code. */
export function DrillAmount({ amount, accountCode }: { amount: number; accountCode: string }) {
  const formatted = amount.toFixed(2);
  if (amount === 0) return <>{formatted}</>;
  return (
    <Link
      to={`/ledger?trialBalance.q=${encodeURIComponent(accountCode)}`}
      className="cursor-pointer text-primary hover:underline"
    >
      {formatted}
    </Link>
  );
}
