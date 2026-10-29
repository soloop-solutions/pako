import { useRef } from "react";
import { useIntl } from "react-intl";

import { PrintButton } from "@/components/shared/PrintButton";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton, LockNotice } from "./shared";
import { isOnOrBeforeLock } from "./helpers";
import type { useSalesBookReport } from "./useSalesBookReport";

export function SalesBookTab({ report, companyName, taxLockDate }: { report: ReturnType<typeof useSalesBookReport>; companyName: string; taxLockDate: string | undefined }) {
  const intl = useIntl();
  const printRef = useRef<HTMLDivElement>(null);
  const { salesBookFrom, setSalesBookFrom, salesBookTo, setSalesBookTo, salesBook, salesBookPeriod, salesBookError, salesBookLoading, salesBookExporting, loadSalesBook, exportSalesBook } = report;

  const salesBookLocked = !!salesBookPeriod && isOnOrBeforeLock(salesBookPeriod.to, taxLockDate);


  return (
    <Card ref={printRef}>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "reports.salesBook" })}</CardTitle>
        <CardDescription>{companyName}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="sales-book-from">{intl.formatMessage({ id: "reports.from" })}</Label>
            <Input id="sales-book-from" type="date" value={salesBookFrom} onChange={(event) => setSalesBookFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sales-book-to">{intl.formatMessage({ id: "reports.to" })}</Label>
            <Input id="sales-book-to" type="date" value={salesBookTo} onChange={(event) => setSalesBookTo(event.target.value)} />
          </div>
          <Button onClick={loadSalesBook} disabled={salesBookLoading}>
            {salesBookLoading ? intl.formatMessage({ id: "reports.loadingReport" }) : intl.formatMessage({ id: "reports.runReport" })}
          </Button>
          {salesBook && <ExportButton onClick={() => void exportSalesBook()} loading={salesBookExporting} />}
          {salesBook && <PrintButton contentRef={printRef} landscape />}
        </div>

        {salesBookLocked && <LockNotice lockDate={taxLockDate ?? ""} messageId="reports.periodLockedTax" />}

        {salesBookError && (
          <Alert variant="destructive">
            <AlertDescription>{salesBookError}</AlertDescription>
          </Alert>
        )}

        {salesBook && (
          <>
            {salesBook.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "reports.bookNone" })}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{intl.formatMessage({ id: "reports.bookInvoiceNumber" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "reports.bookIssueDate" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "reports.bookDocumentType" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "common.partner" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "reports.bookTaxNumber" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "reports.bookFiscalNumber" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "reports.bookVatCode" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "reports.rate" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "reports.bookNet" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "reports.bookVat" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "reports.bookGross" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesBook.lines.map((line, index) => (
                    <TableRow key={`${line.invoiceId}-${line.vatCode}-${index}`}>
                      <TableCell>{line.invoiceNumber ?? "-"}</TableCell>
                      <TableCell className="tabular-nums">{line.issueDate}</TableCell>
                      <TableCell>{line.documentType}</TableCell>
                      <TableCell>{line.partnerName}</TableCell>
                      <TableCell>{line.partnerTaxNumber ?? "-"}</TableCell>
                      <TableCell>{line.partnerFiscalNumber ?? "-"}</TableCell>
                      <TableCell>{line.vatCode}</TableCell>
                      <TableCell className="text-right tabular-nums">{(line.rate * 100).toFixed(0)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{line.netAmount.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.vatAmount.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.grossAmount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex flex-col items-end gap-1 text-sm">
              <p>{intl.formatMessage({ id: "reports.bookTotalNet" }, { amount: salesBook.totalNet.toFixed(2) })}</p>
              <p>{intl.formatMessage({ id: "reports.bookTotalVat" }, { amount: salesBook.totalVat.toFixed(2) })}</p>
              <p className="font-medium">{intl.formatMessage({ id: "reports.bookTotalGross" }, { amount: salesBook.totalGross.toFixed(2) })}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
