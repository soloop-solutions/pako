import type { ReactNode } from "react";
import { useIntl } from "react-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { isOnOrBeforeLock } from "./helpers";
import { ExportButton, LockNotice } from "./shared";

export function DateRangeFields({ idPrefix, from, to, onFrom, onTo }: { idPrefix: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const intl = useIntl();
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-from`}>{intl.formatMessage({ id: "reports.from" })}</Label>
        <Input id={`${idPrefix}-from`} type="date" value={from} onChange={(event) => onFrom(event.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-to`}>{intl.formatMessage({ id: "reports.to" })}</Label>
        <Input id={`${idPrefix}-to`} type="date" value={to} onChange={(event) => onTo(event.target.value)} />
      </div>
    </>
  );
}

export function ReportShell({
  titleId,
  companyName,
  controls,
  periodEnd,
  accountingLockDate,
  onExport,
  exporting,
  exportError,
  error,
  children,
}: {
  titleId: string;
  companyName: string;
  controls: ReactNode;
  periodEnd: string;
  accountingLockDate: string | undefined;
  onExport: () => void;
  exporting: boolean;
  exportError: string | null;
  error: string | null;
  children: ReactNode;
}) {
  const intl = useIntl();
  const locked = isOnOrBeforeLock(periodEnd, accountingLockDate);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: titleId })}</CardTitle>
        <CardDescription>{companyName}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          {controls}
          <ExportButton onClick={onExport} loading={exporting} />
        </div>
        {locked && <LockNotice lockDate={accountingLockDate ?? ""} messageId="reports.periodLockedAccounting" />}
        {(error || exportError) && (
          <Alert variant="destructive">
            <AlertDescription>{error ?? exportError}</AlertDescription>
          </Alert>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
