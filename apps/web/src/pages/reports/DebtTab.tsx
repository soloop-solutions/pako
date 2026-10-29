import { useRef } from "react";
import { useIntl } from "react-intl";

import type { DebtAgingResponse } from "@pako/shared";

import { PrintButton } from "@/components/shared/PrintButton";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ExportButton, LockNotice } from "./shared";
import { downloadRows, isOnOrBeforeLock, type ExcelRow } from "./helpers";
import type { useDebtReport } from "./useDebtReport";

export function DebtTab({ report, accountingLockDate }: { report: ReturnType<typeof useDebtReport>; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const printRef = useRef<HTMLDivElement>(null);
  const { debtAsOf, setDebtAsOf, debtAging, debtAsOfLoaded, debtError, debtLoading, loadDebtAging, debtPartnerName } = report;

  const debtLocked = !!debtAsOfLoaded && isOnOrBeforeLock(debtAsOfLoaded, accountingLockDate);

  function exportDebtAging() {
    if (!debtAging || !debtAsOfLoaded) return;
    const buckets: [string, DebtAgingResponse["lines"][number]["bucket"], number, string][] = [
      ["reports.debtCurrent", "Current", debtAging.totalCurrent, "reports.totalCurrent"],
      ["reports.debtWithinGrace", "WithinGrace", debtAging.totalWithinGrace, "reports.totalWithinGrace"],
      ["reports.debtOverdue", "Overdue", debtAging.totalOverdue, "reports.totalOverdue"],
    ];
    const rows: ExcelRow[] = [[intl.formatMessage({ id: "reports.debtAging" }), debtAsOfLoaded], []];
    for (const [titleKey, bucket, total, totalKey] of buckets) {
      const lines = debtAging.lines.filter((line) => line.bucket === bucket);
      rows.push(
        [intl.formatMessage({ id: titleKey })],
        [
          intl.formatMessage({ id: "reports.debtInvoiceNumber" }),
          intl.formatMessage({ id: "reports.debtCustomer" }),
          intl.formatMessage({ id: "reports.debtDueDate" }),
          intl.formatMessage({ id: "reports.debtOutstanding" }),
        ],
        ...lines.map((line): ExcelRow => [line.invoiceNumber ?? "-", debtPartnerName(line.partnerId), line.dueDate, line.outstanding]),
        [intl.formatMessage({ id: totalKey }, { amount: total.toFixed(2) })],
        [],
      );
    }
    if (debtLocked) rows.push([intl.formatMessage({ id: "reports.periodLockedAccounting" }, { date: accountingLockDate ?? "" })]);
    downloadRows(rows, `debt-aging_${debtAsOfLoaded}`);
  }

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
          {debtAging && <ExportButton onClick={exportDebtAging} />}
          {debtAging && <PrintButton contentRef={printRef} />}
        </div>

        {debtLocked && <LockNotice lockDate={accountingLockDate ?? ""} messageId="reports.periodLockedAccounting" />}

        {debtError && (
          <Alert variant="destructive">
            <AlertDescription>{debtError}</AlertDescription>
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
                          <TableRow key={line.invoiceId}>
                            <TableCell>{line.invoiceNumber ?? "-"}</TableCell>
                            <TableCell>{debtPartnerName(line.partnerId)}</TableCell>
                            <TableCell>{line.dueDate}</TableCell>
                            <TableCell className="text-right">{line.outstanding.toFixed(2)}</TableCell>
                          </TableRow>
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
