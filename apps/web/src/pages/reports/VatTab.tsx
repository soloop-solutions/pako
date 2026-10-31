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
import { ExportButton, LockNotice } from "./shared";
import { isOnOrBeforeLock } from "./helpers";
import type { useVatReport } from "./useVatReport";

export function VatTab({ report, companyName, taxLockDate }: { report: ReturnType<typeof useVatReport>; companyName: string; taxLockDate: string | undefined }) {
  const intl = useIntl();
  const printRef = useRef<HTMLDivElement>(null);
  const { vatFrom, setVatFrom, vatTo, setVatTo, vatReturn, vatPeriod, vatError, vatLoading, loadVatReturn, exporter } = report;

  const vatLocked = !!vatPeriod && isOnOrBeforeLock(vatPeriod.to, taxLockDate);

  return (
    <Card ref={printRef}>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "reports.vatReturnTab" })}</CardTitle>
        <CardDescription>{companyName}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="vat-from">{intl.formatMessage({ id: "reports.from" })}</Label>
            <Input id="vat-from" type="date" value={vatFrom} onChange={(event) => setVatFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="vat-to">{intl.formatMessage({ id: "reports.to" })}</Label>
            <Input id="vat-to" type="date" value={vatTo} onChange={(event) => setVatTo(event.target.value)} />
          </div>
          <Button onClick={loadVatReturn} disabled={vatLoading}>
            {vatLoading ? intl.formatMessage({ id: "reports.loadingReport" }) : intl.formatMessage({ id: "reports.runReport" })}
          </Button>
          <ExportButton onClick={exporter.exportFile} loading={exporter.exporting} />
          {vatReturn && <PrintButton contentRef={printRef} />}
        </div>

        {vatLocked && <LockNotice lockDate={taxLockDate ?? ""} messageId="reports.periodLockedTax" />}

        {(vatError || exporter.exportError) && (
          <Alert variant="destructive">
            <AlertDescription>{vatError ?? exporter.exportError}</AlertDescription>
          </Alert>
        )}

        {vatReturn && (
          <>
            <div>
              <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.outputVat" })}<AccountingTooltip termKey="tooltip.outputVat" /></h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{intl.formatMessage({ id: "reports.tax" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "reports.rate" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "common.amount" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vatReturn.outputVat.map((line) => (
                    <TableRow key={line.taxDefinitionId}>
                      <TableCell>{line.name}</TableCell>
                      <TableCell className="text-right">{(line.rate * 100).toFixed(0)}%</TableCell>
                      <TableCell className="text-right">{line.amount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.inputVat" })}<AccountingTooltip termKey="tooltip.inputVat" /></h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{intl.formatMessage({ id: "reports.tax" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "reports.rate" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "common.amount" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vatReturn.inputVat.map((line) => (
                    <TableRow key={line.taxDefinitionId}>
                      <TableCell>{line.name}</TableCell>
                      <TableCell className="text-right">{(line.rate * 100).toFixed(0)}%</TableCell>
                      <TableCell className="text-right">{line.amount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col items-end gap-1 text-sm">
              <p>{intl.formatMessage({ id: "reports.totalOutputVat" }, { amount: vatReturn.totalOutputVat.toFixed(2) })}</p>
              <p>{intl.formatMessage({ id: "reports.totalInputVat" }, { amount: vatReturn.totalInputVat.toFixed(2) })}</p>
              <p className="font-medium">{intl.formatMessage({ id: "reports.netVatDue" }, { amount: vatReturn.netVatDue.toFixed(2) })}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
