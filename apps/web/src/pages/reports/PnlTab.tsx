import { useRef } from "react";
import { useIntl } from "react-intl";

import { PrintButton } from "@/components/shared/PrintButton";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountingTooltip } from "@/components/shared/AccountingTooltip";
import { DrillAmount, ExportButton, LockNotice } from "./shared";
import { isOnOrBeforeLock } from "./helpers";
import type { usePnlReport } from "./usePnlReport";

export function PnlTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof usePnlReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const printRef = useRef<HTMLDivElement>(null);
  const { pnlFrom, setPnlFrom, pnlTo, setPnlTo, pnl, pnlPeriod, pnlError, pnlLoading, loadPnl, exporter } = report;

  // Locked-ness is derived from the *loaded* period snapshot, not the live date inputs — otherwise
  // editing a date field without re-running would silently change the badge (and the export's
  // lock notice) while the table underneath kept showing the previously-loaded, still-current data.
  const pnlLocked = !!pnlPeriod && isOnOrBeforeLock(pnlPeriod.to, accountingLockDate);

  return (
    <Card ref={printRef}>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "reports.profitAndLoss" })}</CardTitle>
        <CardDescription>{companyName}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pnl-from">{intl.formatMessage({ id: "reports.from" })}</Label>
            <Input id="pnl-from" type="date" value={pnlFrom} onChange={(event) => setPnlFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pnl-to">{intl.formatMessage({ id: "reports.to" })}</Label>
            <Input id="pnl-to" type="date" value={pnlTo} onChange={(event) => setPnlTo(event.target.value)} />
          </div>
          <Button onClick={loadPnl} disabled={pnlLoading}>
            {pnlLoading ? intl.formatMessage({ id: "reports.loadingReport" }) : intl.formatMessage({ id: "reports.runReport" })}
          </Button>
          <ExportButton onClick={exporter.exportFile} loading={exporter.exporting} />
          {pnl && <PrintButton contentRef={printRef} />}
        </div>

        {pnlLocked && <LockNotice lockDate={accountingLockDate ?? ""} messageId="reports.periodLockedAccounting" />}

        {(pnlError || exporter.exportError) && (
          <Alert variant="destructive">
            <AlertDescription>{pnlError ?? exporter.exportError}</AlertDescription>
          </Alert>
        )}

        {pnl && (
          <>
            <div>
              <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.income" })}<AccountingTooltip termKey="tooltip.income" /></h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{intl.formatMessage({ id: "common.code" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "ledger.account" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "common.amount" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pnl.income.map((line) => (
                    <TableRow key={line.accountId}>
                      <TableCell>{line.accountCode}</TableCell>
                      <TableCell>{line.accountName}</TableCell>
                      <TableCell className="text-right"><DrillAmount amount={line.amount} accountCode={line.accountCode} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.expenses" })}<AccountingTooltip termKey="tooltip.expenses" /></h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{intl.formatMessage({ id: "common.code" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "ledger.account" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "common.amount" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pnl.expenses.map((line) => (
                    <TableRow key={line.accountId}>
                      <TableCell>{line.accountCode}</TableCell>
                      <TableCell>{line.accountName}</TableCell>
                      <TableCell className="text-right"><DrillAmount amount={line.amount} accountCode={line.accountCode} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col items-end gap-1 text-sm">
              <p>{intl.formatMessage({ id: "reports.totalIncome" }, { amount: pnl.totalIncome.toFixed(2) })}</p>
              <p>{intl.formatMessage({ id: "reports.totalExpenses" }, { amount: pnl.totalExpenses.toFixed(2) })}</p>
              <p className="font-medium">{intl.formatMessage({ id: "reports.netIncome" }, { amount: pnl.netIncome.toFixed(2) })}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
