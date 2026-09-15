import { useState } from "react";
import { useIntl } from "react-intl";
import { Download, Lock } from "lucide-react";
import type { BalanceSheetResponse, DebtAgingResponse, PartnerResponse, ProfitAndLossResponse, VatReturnResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";

type Tab = "pnl" | "balance-sheet" | "vat" | "debt";
type ExcelRow = (string | number)[];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

// F10 lock-awareness is scoped to the two real, backend-enforced lock fields on `Company`
// (accountingLockDate/taxLockDate — see JournalEntry.Post()'s lock-date checks). The other three
// lock types in LockDatesSettings.tsx (sale/purchase/hard) are a self-contained mock with zero
// server enforcement and their own independent in-memory state, not synced with these real fields
// — surfacing them here as "locked" would risk an accountant thinking a real period is closed when
// nothing on the backend actually blocks it. Dates are plain ISO (YYYY-MM-DD) strings throughout
// this file already, so a lexicographic comparison is a correct "on or before" check.
function isOnOrBeforeLock(date: string, lockDate: string | undefined): boolean {
  return !!lockDate && date <= lockDate;
}

// Dynamically imported, same as DataGrid.tsx's own export button — keeps the xlsx library out of
// the main bundle until someone actually exports something.
function downloadRows(rows: (string | number)[][], fileName: string): void {
  void import("@/components/data-grid/exportToExcel").then(({ exportRowsToExcel }) => exportRowsToExcel(rows, fileName));
}

function LockNotice({ lockDate, messageId }: { lockDate: string; messageId: "reports.periodLockedAccounting" | "reports.periodLockedTax" }) {
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

function ExportButton({ onClick }: { onClick: () => void }) {
  const intl = useIntl();
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <Download className="size-3.5" />
      {intl.formatMessage({ id: "reports.exportToExcel" })}
    </Button>
  );
}

export function Reports() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const TABS: { key: Tab; labelKey: string }[] = [
    { key: "pnl", labelKey: "reports.profitAndLoss" },
    { key: "balance-sheet", labelKey: "reports.balanceSheet" },
    { key: "vat", labelKey: "reports.vatReturn" },
    { key: "debt", labelKey: "reports.debtAging" },
  ];

  const [tab, setTab] = useState<Tab>("pnl");

  const [pnlFrom, setPnlFrom] = useState(startOfMonth);
  const [pnlTo, setPnlTo] = useState(today);
  const [pnl, setPnl] = useState<ProfitAndLossResponse | null>(null);
  // The period the currently-displayed `pnl` was actually loaded for — set only on a successful
  // load, never from the live `pnlFrom`/`pnlTo` inputs. The lock badge and the exported file must
  // describe what's on screen, not an edited-but-not-yet-submitted date range; see the same pattern
  // on balanceSheetPeriod/vatPeriod/debtPeriod below.
  const [pnlPeriod, setPnlPeriod] = useState<{ from: string; to: string } | null>(null);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [pnlLoading, setPnlLoading] = useState(false);

  const [asOf, setAsOf] = useState(today);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetResponse | null>(null);
  const [balanceSheetAsOf, setBalanceSheetAsOf] = useState<string | null>(null);
  const [balanceSheetError, setBalanceSheetError] = useState<string | null>(null);
  const [balanceSheetLoading, setBalanceSheetLoading] = useState(false);

  const [vatFrom, setVatFrom] = useState(startOfMonth);
  const [vatTo, setVatTo] = useState(today);
  const [vatReturn, setVatReturn] = useState<VatReturnResponse | null>(null);
  const [vatPeriod, setVatPeriod] = useState<{ from: string; to: string } | null>(null);
  const [vatError, setVatError] = useState<string | null>(null);
  const [vatLoading, setVatLoading] = useState(false);

  const [debtAsOf, setDebtAsOf] = useState(today);
  const [debtAging, setDebtAging] = useState<DebtAgingResponse | null>(null);
  const [debtAsOfLoaded, setDebtAsOfLoaded] = useState<string | null>(null);
  const [debtPartners, setDebtPartners] = useState<PartnerResponse[]>([]);
  const [debtError, setDebtError] = useState<string | null>(null);
  const [debtLoading, setDebtLoading] = useState(false);

  async function loadPnl() {
    if (!companyId) return;
    setPnlError(null);
    setPnlLoading(true);
    try {
      const result = await apiClient.profitAndLoss(companyId, pnlFrom, pnlTo);
      setPnl(result);
      setPnlPeriod({ from: pnlFrom, to: pnlTo });
    } catch (err) {
      setPnlError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.pnlLoadError" })));
    } finally {
      setPnlLoading(false);
    }
  }

  async function loadBalanceSheet() {
    if (!companyId) return;
    setBalanceSheetError(null);
    setBalanceSheetLoading(true);
    try {
      const result = await apiClient.balanceSheet(companyId, asOf);
      setBalanceSheet(result);
      setBalanceSheetAsOf(asOf);
    } catch (err) {
      setBalanceSheetError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.balanceSheetLoadError" })));
    } finally {
      setBalanceSheetLoading(false);
    }
  }

  async function loadVatReturn() {
    if (!companyId) return;
    setVatError(null);
    setVatLoading(true);
    try {
      const result = await apiClient.vatReturn(companyId, vatFrom, vatTo);
      setVatReturn(result);
      setVatPeriod({ from: vatFrom, to: vatTo });
    } catch (err) {
      setVatError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.vatLoadError" })));
    } finally {
      setVatLoading(false);
    }
  }

  async function loadDebtAging() {
    if (!companyId) return;
    setDebtError(null);
    setDebtLoading(true);
    try {
      const [debtAgingResult, partnersResult] = await Promise.all([
        apiClient.debtAging(companyId, debtAsOf),
        apiClient.partnersAll(companyId),
      ]);
      setDebtAging(debtAgingResult);
      setDebtAsOfLoaded(debtAsOf);
      setDebtPartners(partnersResult);
    } catch (err) {
      setDebtError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.debtAgingLoadError" })));
    } finally {
      setDebtLoading(false);
    }
  }

  function debtPartnerName(partnerId: string) {
    return debtPartners.find((p) => p.id === partnerId)?.name ?? partnerId;
  }

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "reports.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "reports.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
        </CardContent>
      </Card>
    );
  }

  const accountingLockDate = activeCompany.accountingLockDate;
  const taxLockDate = activeCompany.taxLockDate;
  // Locked-ness is derived from the *loaded* period snapshot, not the live date inputs — otherwise
  // editing a date field without re-running would silently change the badge (and the export's
  // lock notice) while the table underneath kept showing the previously-loaded, still-current data.
  const pnlLocked = !!pnlPeriod && isOnOrBeforeLock(pnlPeriod.to, accountingLockDate);
  const balanceSheetLocked = !!balanceSheetAsOf && isOnOrBeforeLock(balanceSheetAsOf, accountingLockDate);
  const vatLocked = !!vatPeriod && isOnOrBeforeLock(vatPeriod.to, taxLockDate);
  const debtLocked = !!debtAsOfLoaded && isOnOrBeforeLock(debtAsOfLoaded, accountingLockDate);

  function exportPnl() {
    if (!pnl || !pnlPeriod) return;
    const rows: ExcelRow[] = [
      [intl.formatMessage({ id: "reports.profitAndLoss" }), `${pnlPeriod.from} – ${pnlPeriod.to}`],
      [],
      [intl.formatMessage({ id: "reports.income" })],
      [intl.formatMessage({ id: "common.code" }), intl.formatMessage({ id: "ledger.account" }), intl.formatMessage({ id: "common.amount" })],
      ...pnl.income.map((line): ExcelRow => [line.accountCode, line.accountName, line.amount]),
      [],
      [intl.formatMessage({ id: "reports.expenses" })],
      [intl.formatMessage({ id: "common.code" }), intl.formatMessage({ id: "ledger.account" }), intl.formatMessage({ id: "common.amount" })],
      ...pnl.expenses.map((line): ExcelRow => [line.accountCode, line.accountName, line.amount]),
      [],
      [intl.formatMessage({ id: "reports.totalIncome" }, { amount: pnl.totalIncome.toFixed(2) })],
      [intl.formatMessage({ id: "reports.totalExpenses" }, { amount: pnl.totalExpenses.toFixed(2) })],
      [intl.formatMessage({ id: "reports.netIncome" }, { amount: pnl.netIncome.toFixed(2) })],
    ];
    if (pnlLocked) rows.push([], [intl.formatMessage({ id: "reports.periodLockedAccounting" }, { date: accountingLockDate ?? "" })]);
    downloadRows(rows, `profit-and-loss_${pnlPeriod.from}_${pnlPeriod.to}`);
  }

  function exportBalanceSheet() {
    if (!balanceSheet || !balanceSheetAsOf) return;
    const sections: [string, BalanceSheetResponse["assets"], number, string][] = [
      ["reports.assets", balanceSheet.assets, balanceSheet.totalAssets, "reports.totalAssets"],
      ["reports.liabilities", balanceSheet.liabilities, balanceSheet.totalLiabilities, "reports.totalLiabilities"],
      ["reports.equity", balanceSheet.equity, balanceSheet.totalEquity, "reports.totalEquity"],
    ];
    const rows: ExcelRow[] = [[intl.formatMessage({ id: "reports.balanceSheet" }), balanceSheetAsOf], []];
    for (const [titleKey, lines, total, totalKey] of sections) {
      rows.push(
        [intl.formatMessage({ id: titleKey })],
        [intl.formatMessage({ id: "common.code" }), intl.formatMessage({ id: "ledger.account" }), intl.formatMessage({ id: "common.amount" })],
        ...lines.map((line): ExcelRow => [line.accountCode, line.accountName, line.amount]),
        [intl.formatMessage({ id: totalKey }, { amount: total.toFixed(2) })],
        [],
      );
    }
    rows.push([
      intl.formatMessage(
        { id: "reports.balanceEquation" },
        {
          assets: balanceSheet.totalAssets.toFixed(2),
          liabilitiesPlusEquity: (balanceSheet.totalLiabilities + balanceSheet.totalEquity).toFixed(2),
        },
      ),
    ]);
    if (balanceSheetLocked) rows.push([], [intl.formatMessage({ id: "reports.periodLockedAccounting" }, { date: accountingLockDate ?? "" })]);
    downloadRows(rows, `balance-sheet_${balanceSheetAsOf}`);
  }

  function exportVatReturn() {
    if (!vatReturn || !vatPeriod) return;
    const rows: ExcelRow[] = [
      [intl.formatMessage({ id: "reports.vatReturn" }), `${vatPeriod.from} – ${vatPeriod.to}`],
      [],
      [intl.formatMessage({ id: "reports.outputVat" })],
      [intl.formatMessage({ id: "reports.tax" }), intl.formatMessage({ id: "reports.rate" }), intl.formatMessage({ id: "common.amount" })],
      ...vatReturn.outputVat.map((line): ExcelRow => [line.name, `${(line.rate * 100).toFixed(0)}%`, line.amount]),
      [],
      [intl.formatMessage({ id: "reports.inputVat" })],
      [intl.formatMessage({ id: "reports.tax" }), intl.formatMessage({ id: "reports.rate" }), intl.formatMessage({ id: "common.amount" })],
      ...vatReturn.inputVat.map((line): ExcelRow => [line.name, `${(line.rate * 100).toFixed(0)}%`, line.amount]),
      [],
      [intl.formatMessage({ id: "reports.totalOutputVat" }, { amount: vatReturn.totalOutputVat.toFixed(2) })],
      [intl.formatMessage({ id: "reports.totalInputVat" }, { amount: vatReturn.totalInputVat.toFixed(2) })],
      [intl.formatMessage({ id: "reports.netVatDue" }, { amount: vatReturn.netVatDue.toFixed(2) })],
    ];
    if (vatLocked) rows.push([], [intl.formatMessage({ id: "reports.periodLockedTax" }, { date: taxLockDate ?? "" })]);
    downloadRows(rows, `vat-return_${vatPeriod.from}_${vatPeriod.to}`);
  }

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
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            type="button"
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t.key)}
          >
            {intl.formatMessage({ id: t.labelKey })}
          </Button>
        ))}
      </div>

      {tab === "pnl" && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "reports.profitAndLoss" })}</CardTitle>
            <CardDescription>{activeCompany.name}</CardDescription>
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
              {pnl && <ExportButton onClick={exportPnl} />}
            </div>

            {pnlLocked && <LockNotice lockDate={accountingLockDate ?? ""} messageId="reports.periodLockedAccounting" />}

            {pnlError && (
              <Alert variant="destructive">
                <AlertDescription>{pnlError}</AlertDescription>
              </Alert>
            )}

            {pnl && (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.income" })}</h3>
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
                          <TableCell className="text-right">{line.amount.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.expenses" })}</h3>
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
                          <TableCell className="text-right">{line.amount.toFixed(2)}</TableCell>
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
      )}

      {tab === "balance-sheet" && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "reports.balanceSheet" })}</CardTitle>
            <CardDescription>{activeCompany.name}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="bs-as-of">{intl.formatMessage({ id: "reports.asOf" })}</Label>
                <Input id="bs-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
              </div>
              <Button onClick={loadBalanceSheet} disabled={balanceSheetLoading}>
                {balanceSheetLoading ? intl.formatMessage({ id: "reports.loadingReport" }) : intl.formatMessage({ id: "reports.runReport" })}
              </Button>
              {balanceSheet && <ExportButton onClick={exportBalanceSheet} />}
            </div>

            {balanceSheetLocked && <LockNotice lockDate={accountingLockDate ?? ""} messageId="reports.periodLockedAccounting" />}

            {balanceSheetError && (
              <Alert variant="destructive">
                <AlertDescription>{balanceSheetError}</AlertDescription>
              </Alert>
            )}

            {balanceSheet && (
              <>
                {(
                  [
                    ["reports.assets", balanceSheet.assets, balanceSheet.totalAssets, "reports.totalAssets"],
                    ["reports.liabilities", balanceSheet.liabilities, balanceSheet.totalLiabilities, "reports.totalLiabilities"],
                    ["reports.equity", balanceSheet.equity, balanceSheet.totalEquity, "reports.totalEquity"],
                  ] as const
                ).map(([titleKey, lines, total, totalKey]) => (
                  <div key={titleKey}>
                    <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: titleKey })}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{intl.formatMessage({ id: "common.code" })}</TableHead>
                          <TableHead>{intl.formatMessage({ id: "ledger.account" })}</TableHead>
                          <TableHead className="text-right">{intl.formatMessage({ id: "common.amount" })}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => (
                          <TableRow key={line.accountId}>
                            <TableCell>{line.accountCode}</TableCell>
                            <TableCell>{line.accountName}</TableCell>
                            <TableCell className="text-right">{line.amount.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="mt-1 text-right text-sm font-medium">
                      {intl.formatMessage({ id: totalKey }, { amount: total.toFixed(2) })}
                    </p>
                  </div>
                ))}

                <p
                  className={cn(
                    "text-sm font-medium",
                    Math.abs(balanceSheet.totalAssets - (balanceSheet.totalLiabilities + balanceSheet.totalEquity)) < 0.01
                      ? "text-foreground"
                      : "text-destructive",
                  )}
                >
                  {intl.formatMessage(
                    { id: "reports.balanceEquation" },
                    {
                      assets: balanceSheet.totalAssets.toFixed(2),
                      liabilitiesPlusEquity: (balanceSheet.totalLiabilities + balanceSheet.totalEquity).toFixed(2),
                    },
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "vat" && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "reports.vatReturn" })}</CardTitle>
            <CardDescription>{activeCompany.name}</CardDescription>
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
              {vatReturn && <ExportButton onClick={exportVatReturn} />}
            </div>

            {vatLocked && <LockNotice lockDate={taxLockDate ?? ""} messageId="reports.periodLockedTax" />}

            {vatError && (
              <Alert variant="destructive">
                <AlertDescription>{vatError}</AlertDescription>
              </Alert>
            )}

            {vatReturn && (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.outputVat" })}</h3>
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
                  <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.inputVat" })}</h3>
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
      )}

      {tab === "debt" && (
        <Card>
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
      )}
    </div>
  );
}
