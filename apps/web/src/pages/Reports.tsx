import { useState } from "react";
import type { BalanceSheetResponse, ProfitAndLossResponse, VatReturnResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";

type Tab = "pnl" | "balance-sheet" | "vat";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

const TABS: { key: Tab; label: string }[] = [
  { key: "pnl", label: "Profit & Loss" },
  { key: "balance-sheet", label: "Balance Sheet" },
  { key: "vat", label: "VAT Return" },
];

export function Reports() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [tab, setTab] = useState<Tab>("pnl");

  const [pnlFrom, setPnlFrom] = useState(startOfMonth);
  const [pnlTo, setPnlTo] = useState(today);
  const [pnl, setPnl] = useState<ProfitAndLossResponse | null>(null);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [pnlLoading, setPnlLoading] = useState(false);

  const [asOf, setAsOf] = useState(today);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetResponse | null>(null);
  const [balanceSheetError, setBalanceSheetError] = useState<string | null>(null);
  const [balanceSheetLoading, setBalanceSheetLoading] = useState(false);

  const [vatFrom, setVatFrom] = useState(startOfMonth);
  const [vatTo, setVatTo] = useState(today);
  const [vatReturn, setVatReturn] = useState<VatReturnResponse | null>(null);
  const [vatError, setVatError] = useState<string | null>(null);
  const [vatLoading, setVatLoading] = useState(false);

  async function loadPnl() {
    if (!companyId) return;
    setPnlError(null);
    setPnlLoading(true);
    try {
      setPnl(await apiClient.profitAndLoss(companyId, pnlFrom, pnlTo));
    } catch (err) {
      setPnlError(getApiErrorMessage(err, "Could not load the P&L report."));
    } finally {
      setPnlLoading(false);
    }
  }

  async function loadBalanceSheet() {
    if (!companyId) return;
    setBalanceSheetError(null);
    setBalanceSheetLoading(true);
    try {
      setBalanceSheet(await apiClient.balanceSheet(companyId, asOf));
    } catch (err) {
      setBalanceSheetError(getApiErrorMessage(err, "Could not load the balance sheet."));
    } finally {
      setBalanceSheetLoading(false);
    }
  }

  async function loadVatReturn() {
    if (!companyId) return;
    setVatError(null);
    setVatLoading(true);
    try {
      setVatReturn(await apiClient.vatReturn(companyId, vatFrom, vatTo));
    } catch (err) {
      setVatError(getApiErrorMessage(err, "Could not load the VAT return."));
    } finally {
      setVatLoading(false);
    }
  }

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
          <CardDescription>Balance sheet, P&amp;L, and VAT return.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select or create a company on the Companies page first.</p>
        </CardContent>
      </Card>
    );
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
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "pnl" && (
        <Card>
          <CardHeader>
            <CardTitle>Profit &amp; Loss</CardTitle>
            <CardDescription>{activeCompany.name}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="pnl-from">From</Label>
                <Input id="pnl-from" type="date" value={pnlFrom} onChange={(event) => setPnlFrom(event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pnl-to">To</Label>
                <Input id="pnl-to" type="date" value={pnlTo} onChange={(event) => setPnlTo(event.target.value)} />
              </div>
              <Button onClick={loadPnl} disabled={pnlLoading}>
                {pnlLoading ? "Loading..." : "Run report"}
              </Button>
            </div>

            {pnlError && (
              <Alert variant="destructive">
                <AlertDescription>{pnlError}</AlertDescription>
              </Alert>
            )}

            {pnl && (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Income</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
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
                  <h3 className="mb-2 text-sm font-medium">Expenses</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
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
                  <p>Total income: {pnl.totalIncome.toFixed(2)}</p>
                  <p>Total expenses: {pnl.totalExpenses.toFixed(2)}</p>
                  <p className="font-medium">Net income: {pnl.netIncome.toFixed(2)}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "balance-sheet" && (
        <Card>
          <CardHeader>
            <CardTitle>Balance Sheet</CardTitle>
            <CardDescription>{activeCompany.name}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="bs-as-of">As of</Label>
                <Input id="bs-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
              </div>
              <Button onClick={loadBalanceSheet} disabled={balanceSheetLoading}>
                {balanceSheetLoading ? "Loading..." : "Run report"}
              </Button>
            </div>

            {balanceSheetError && (
              <Alert variant="destructive">
                <AlertDescription>{balanceSheetError}</AlertDescription>
              </Alert>
            )}

            {balanceSheet && (
              <>
                {(
                  [
                    ["Assets", balanceSheet.assets, balanceSheet.totalAssets],
                    ["Liabilities", balanceSheet.liabilities, balanceSheet.totalLiabilities],
                    ["Equity", balanceSheet.equity, balanceSheet.totalEquity],
                  ] as const
                ).map(([title, lines, total]) => (
                  <div key={title}>
                    <h3 className="mb-2 text-sm font-medium">{title}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Account</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
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
                    <p className="mt-1 text-right text-sm font-medium">Total {title.toLowerCase()}: {total.toFixed(2)}</p>
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
                  Assets ({balanceSheet.totalAssets.toFixed(2)}) = Liabilities + Equity (
                  {(balanceSheet.totalLiabilities + balanceSheet.totalEquity).toFixed(2)})
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "vat" && (
        <Card>
          <CardHeader>
            <CardTitle>VAT Return</CardTitle>
            <CardDescription>{activeCompany.name}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="vat-from">From</Label>
                <Input id="vat-from" type="date" value={vatFrom} onChange={(event) => setVatFrom(event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="vat-to">To</Label>
                <Input id="vat-to" type="date" value={vatTo} onChange={(event) => setVatTo(event.target.value)} />
              </div>
              <Button onClick={loadVatReturn} disabled={vatLoading}>
                {vatLoading ? "Loading..." : "Run report"}
              </Button>
            </div>

            {vatError && (
              <Alert variant="destructive">
                <AlertDescription>{vatError}</AlertDescription>
              </Alert>
            )}

            {vatReturn && (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Output VAT (sales)</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tax</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
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
                  <h3 className="mb-2 text-sm font-medium">Input VAT (purchases)</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tax</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
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
                  <p>Total output VAT: {vatReturn.totalOutputVat.toFixed(2)}</p>
                  <p>Total input VAT: {vatReturn.totalInputVat.toFixed(2)}</p>
                  <p className="font-medium">Net VAT due: {vatReturn.netVatDue.toFixed(2)}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
