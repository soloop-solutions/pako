import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";

import type { VatDeclarationBox } from "@pako/shared";

import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatAmount, isOnOrBeforeLock } from "./helpers";
import { staticColumn } from "./reportColumns";
import { ExportButton, LockNotice } from "./shared";
import type { useVatDeclarationReport } from "./useVatDeclarationReport";

const SECTION_TITLES: Record<string, string> = {
  Sales: "reports.vatDeclSection.Sales",
  Purchases: "reports.vatDeclSection.Purchases",
  Calculation: "reports.vatDeclSection.Calculation",
};

function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
}

function AmountInput({ id, label, value, onCommit }: { id: string; label: string; value: number | undefined; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(value === undefined ? "" : String(value));
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step="0.01"
        className="w-48"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit(draft);
        }}
      />
    </div>
  );
}

export function VatDeclarationTab({ report, companyName, taxLockDate }: { report: ReturnType<typeof useVatDeclarationReport>; companyName: string; taxLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, data, year, month } = report;
  const [yearDraft, setYearDraft] = useState(String(year));
  const [yearSource, setYearSource] = useState(year);
  const [monthDraft, setMonthDraft] = useState(String(month));
  const [monthSource, setMonthSource] = useState(month);
  if (yearSource !== year) {
    setYearSource(year);
    setYearDraft(String(year));
  }
  if (monthSource !== month) {
    setMonthSource(month);
    setMonthDraft(String(month));
  }

  function changeYear(value: string) {
    setYearDraft(value);
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100) period.setYear(value);
  }

  function changeMonth(value: string) {
    setMonthDraft(value);
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) report.setMonth(value);
  }

  const columns = useMemo<ColumnDef<VatDeclarationBox>[]>(
    () => [
      staticColumn<VatDeclarationBox>({ id: "number", header: intl.formatMessage({ id: "reports.vatDeclBox" }), accessorFn: (row) => row.number }),
      staticColumn<VatDeclarationBox>({ id: "label", header: intl.formatMessage({ id: "common.description" }), accessorFn: (row) => row.label, cell: ({ row }) => row.original.label }),
      staticColumn<VatDeclarationBox>({
        id: "base",
        header: intl.formatMessage({ id: "reports.vatDeclBase" }),
        accessorFn: (row) => row.base,
        cell: ({ row }) => (row.original.base === undefined || row.original.base === null ? "" : formatAmount(row.original.base)),
        meta: { numeric: true },
      }),
      staticColumn<VatDeclarationBox>({
        id: "vat",
        header: intl.formatMessage({ id: "reports.vatDeclVat" }),
        accessorFn: (row) => row.vat,
        cell: ({ row }) => (row.original.vat === undefined || row.original.vat === null ? "" : formatAmount(row.original.vat)),
        meta: { numeric: true },
      }),
    ],
    [intl],
  );

  const sections = useMemo(() => {
    const grouped = new Map<string, VatDeclarationBox[]>();
    for (const box of data?.boxes ?? []) grouped.set(box.section, [...(grouped.get(box.section) ?? []), box]);
    return [...grouped.entries()];
  }, [data]);

  const taxLocked = isOnOrBeforeLock(lastDayOfMonth(year, month), taxLockDate);
  const highlights: [string, string, number][] = data
    ? [
        ["remaining", "reports.vatDeclRemainingCredit", data.remainingCredit],
        ["next", "reports.vatDeclCreditNext", data.creditForNextPeriod],
        ["payable", "reports.vatDeclPayable", data.vatPayable],
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "reports.vatDeclaration" })}</CardTitle>
        <CardDescription>{companyName}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="vat-decl-year">{intl.formatMessage({ id: "reports.year" })}</Label>
            <Input id="vat-decl-year" type="number" min={2000} max={2100} className="w-28" value={yearDraft} onChange={(event) => changeYear(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="vat-decl-month">{intl.formatMessage({ id: "reports.month" })}</Label>
            <Input id="vat-decl-month" type="number" min={1} max={12} className="w-24" value={monthDraft} onChange={(event) => changeMonth(event.target.value)} />
          </div>
          <AmountInput id="vat-decl-carried" label={intl.formatMessage({ id: "reports.vatDeclCarriedCredit" })} value={report.carriedCredit} onCommit={report.setCarriedCredit} />
          <AmountInput id="vat-decl-refund" label={intl.formatMessage({ id: "reports.vatDeclRefund" })} value={report.refundRequested} onCommit={report.setRefundRequested} />
          <ExportButton onClick={report.exportFile} loading={report.exporting} />
        </div>

        {taxLocked && <LockNotice lockDate={taxLockDate ?? ""} messageId="reports.periodLockedTax" />}

        {(report.error || report.exportError) && (
          <Alert variant="destructive">
            <AlertDescription>{report.error ?? report.exportError}</AlertDescription>
          </Alert>
        )}

        {data && (
          <>
            <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "reports.vatDeclTaxpayer" })}</dt>
                <dd className="font-medium">{data.taxpayerName ?? ""}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "reports.vatDeclFiscalNumber" })}</dt>
                <dd className="font-medium tabular-nums">{data.fiscalNumber ?? ""}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "reports.vatDeclAddress" })}</dt>
                <dd className="font-medium">{data.address ?? ""}</dd>
              </div>
            </dl>

            <div data-testid="vat-decl-calculation" className="grid gap-3 sm:grid-cols-3">
              {highlights.map(([key, labelId, value]) => (
                <div key={key} className="flex flex-col gap-1 rounded-md border-2 border-primary/40 bg-primary/5 p-3">
                  <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: labelId })}</span>
                  <span className="text-xl font-semibold tabular-nums">{formatAmount(value)}</span>
                </div>
              ))}
            </div>

            {sections.map(([section, boxes]) => (
              <div key={section} data-testid={`vat-decl-section-${section}`} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{SECTION_TITLES[section] ? intl.formatMessage({ id: SECTION_TITLES[section] }) : section}</h3>
                <DataGrid<VatDeclarationBox>
                  gridId={`vatDeclaration${section}`}
                  columns={columns}
                  data={boxes}
                  rowCount={boxes.length}
                  getRowId={(row) => row.number}
                  defaultPageSize={1000}
                  pageSizeOptions={[1000]}
                  getRowClassName={(row) => (row.base === undefined || row.base === null ? "font-semibold" : undefined)}
                />
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
