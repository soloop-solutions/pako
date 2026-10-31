import { useRef } from "react";
import { useIntl } from "react-intl";

import { PrintButton } from "@/components/shared/PrintButton";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { entityPath, partnerPath } from "@/lib/entityLinks";
import { MaybeEntityLink } from "./EntityLink";
import { LinkedRow } from "./LinkedRow";
import { ExportButton, LockNotice } from "./shared";
import { isOnOrBeforeLock } from "./helpers";
import type { useDebtReport } from "./useDebtReport";

export function DebtTab({ report, accountingLockDate }: { report: ReturnType<typeof useDebtReport>; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const printRef = useRef<HTMLDivElement>(null);
  const { debtAsOf, setDebtAsOf, debtAging, debtAsOfLoaded, debtError, debtLoading, loadDebtAging, debtPartnerName } = report;

  const debtLocked = !!debtAsOfLoaded && isOnOrBeforeLock(debtAsOfLoaded, accountingLockDate);

  return (
    <Card ref={printRef}>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "reports.debtAging" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "reports.debtAgingDescription" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="debt-as-of">{intl.formatMessage({ id: "reports.asOf" })}</Label>
            <Input id="debt-as-of" type="date" value={debtAsOf} onChange={(event) => setDebtAsOf(event.target.value)} />
          </div>
          <Button onClick={loadDebtAging} disabled={debtLoading}>
            {debtLoading ? intl.formatMessage({ id: "reports.loadingReport" }) : intl.formatMessage({ id: "reports.runReport" })}
          </Button>
          {debtAging && <ExportButton onClick={() => void report.exporter.exportFile()} loading={report.exporter.exporting} />}
          {debtAging && <PrintButton contentRef={printRef} />}
        </div>

        {debtLocked && <LockNotice lockDate={accountingLockDate ?? ""} messageId="reports.periodLockedAccounting" />}

        {(debtError || report.exporter.exportError) && (
          <Alert variant="destructive">
            <AlertDescription>{debtError ?? report.exporter.exportError}</AlertDescription>
          </Alert>
        )}

        {debtAging && (
          <>
            {(
              [
                ["reports.debtCurrent", "Current", debtAging.totalCurrent, "reports.totalCurrent"],
                ["reports.debtWithinGrace", "WithinGrace", debtAging.totalWithinGrace, "reports.totalWithinGrace"],
                ["reports.debtOverdue", "Overdue", debtAging.totalOverdue, "reports.totalOverdue"],
              ] as const
            ).map(([titleKey, bucket, total, totalKey]) => {
              const lines = debtAging.lines.filter((line) => line.bucket === bucket);
              return (
                <div key={bucket}>
                  <h3 className={cn("mb-2 text-sm font-medium", bucket === "Overdue" && "text-destructive")}>
                    {intl.formatMessage({ id: titleKey })}
                  </h3>
                  {lines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "reports.debtNone" })}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{intl.formatMessage({ id: "reports.debtInvoiceNumber" })}</TableHead>
                          <TableHead>{intl.formatMessage({ id: "reports.debtCustomer" })}</TableHead>
                          <TableHead>{intl.formatMessage({ id: "reports.debtDueDate" })}</TableHead>
                          <TableHead className="text-right">{intl.formatMessage({ id: "reports.debtOutstanding" })}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => (
                          <LinkedRow key={line.invoiceId} to={entityPath({ kind: line.sourceKind, id: line.sourceId })}>
                            <TableCell>{line.invoiceNumber ?? "-"}</TableCell>
                            <TableCell><MaybeEntityLink to={partnerPath(line.partnerId, "customer")}>{debtPartnerName(line.partnerId)}</MaybeEntityLink></TableCell>
                            <TableCell>{line.dueDate}</TableCell>
                            <TableCell className="text-right">{line.outstanding.toFixed(2)}</TableCell>
                          </LinkedRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  <p className="mt-1 text-right text-sm font-medium">
                    {intl.formatMessage({ id: totalKey }, { amount: total.toFixed(2) })}
                  </p>
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
