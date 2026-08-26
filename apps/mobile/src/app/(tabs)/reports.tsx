import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BalanceSheetResponse, ProfitAndLossResponse, VatReturnResponse } from '@pako/shared';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { SelectCompanyPrompt } from '@/components/select-company-prompt';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'pnl' | 'balance-sheet' | 'vat';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'pnl', label: 'P&L' },
  { key: 'balance-sheet', label: 'Balance Sheet' },
  { key: 'vat', label: 'VAT Return' },
];

function ReportLineRow({ code, name, amount }: { code: string; name: string; amount: number }) {
  return (
    <View style={styles.reportLine}>
      <ThemedText type="small">
        {code} - {name}
      </ThemedText>
      <ThemedText type="small">{amount.toFixed(2)}</ThemedText>
    </View>
  );
}

export default function ReportsScreen() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const theme = useTheme();

  const [tab, setTab] = useState<Tab>('pnl');

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
      setPnlError(getApiErrorMessage(err, 'Could not load the P&L report.'));
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
      setBalanceSheetError(getApiErrorMessage(err, 'Could not load the balance sheet.'));
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
      setVatError(getApiErrorMessage(err, 'Could not load the VAT return.'));
    } finally {
      setVatLoading(false);
    }
  }

  if (!activeCompany) {
    return <SelectCompanyPrompt title="Reports" description="Select or create a company to run reports." />;
  }

  const balanceSheetOk =
    balanceSheet != null && Math.abs(balanceSheet.totalAssets - (balanceSheet.totalLiabilities + balanceSheet.totalEquity)) < 0.01;

  return (
    <Screen>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Button key={t.key} title={t.label} variant={tab === t.key ? 'primary' : 'outline'} onPress={() => setTab(t.key)} />
        ))}
      </View>

      {tab === 'pnl' && (
        <Card>
          <CardHeader title="Profit & Loss" description={activeCompany.name} />
          <TextField label="From (YYYY-MM-DD)" value={pnlFrom} onChangeText={setPnlFrom} />
          <TextField label="To (YYYY-MM-DD)" value={pnlTo} onChangeText={setPnlTo} />
          <Button title={pnlLoading ? 'Loading...' : 'Run report'} onPress={loadPnl} loading={pnlLoading} />

          {pnlError && <ErrorBanner message={pnlError} />}

          {pnl && (
            <View style={styles.reportSection}>
              <ThemedText type="smallBold">Income</ThemedText>
              {pnl.income.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <ThemedText type="smallBold">Expenses</ThemedText>
              {pnl.expenses.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <View style={styles.totals}>
                <ThemedText type="small" themeColor="textSecondary">
                  Total income: {pnl.totalIncome.toFixed(2)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Total expenses: {pnl.totalExpenses.toFixed(2)}
                </ThemedText>
                <ThemedText type="smallBold">Net income: {pnl.netIncome.toFixed(2)}</ThemedText>
              </View>
            </View>
          )}
        </Card>
      )}

      {tab === 'balance-sheet' && (
        <Card>
          <CardHeader title="Balance Sheet" description={activeCompany.name} />
          <TextField label="As of (YYYY-MM-DD)" value={asOf} onChangeText={setAsOf} />
          <Button title={balanceSheetLoading ? 'Loading...' : 'Run report'} onPress={loadBalanceSheet} loading={balanceSheetLoading} />

          {balanceSheetError && <ErrorBanner message={balanceSheetError} />}

          {balanceSheet && (
            <View style={styles.reportSection}>
              <ThemedText type="smallBold">Assets</ThemedText>
              {balanceSheet.assets.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                Total assets: {balanceSheet.totalAssets.toFixed(2)}
              </ThemedText>

              <ThemedText type="smallBold">Liabilities</ThemedText>
              {balanceSheet.liabilities.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                Total liabilities: {balanceSheet.totalLiabilities.toFixed(2)}
              </ThemedText>

              <ThemedText type="smallBold">Equity</ThemedText>
              {balanceSheet.equity.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                Total equity: {balanceSheet.totalEquity.toFixed(2)}
              </ThemedText>

              <ThemedText type="smallBold" style={{ color: balanceSheetOk ? theme.text : theme.danger }}>
                Assets ({balanceSheet.totalAssets.toFixed(2)}) = Liabilities + Equity (
                {(balanceSheet.totalLiabilities + balanceSheet.totalEquity).toFixed(2)})
              </ThemedText>
            </View>
          )}
        </Card>
      )}

      {tab === 'vat' && (
        <Card>
          <CardHeader title="VAT Return" description={activeCompany.name} />
          <TextField label="From (YYYY-MM-DD)" value={vatFrom} onChangeText={setVatFrom} />
          <TextField label="To (YYYY-MM-DD)" value={vatTo} onChangeText={setVatTo} />
          <Button title={vatLoading ? 'Loading...' : 'Run report'} onPress={loadVatReturn} loading={vatLoading} />

          {vatError && <ErrorBanner message={vatError} />}

          {vatReturn && (
            <View style={styles.reportSection}>
              <ThemedText type="smallBold">Output VAT (sales)</ThemedText>
              {vatReturn.outputVat.map((line) => (
                <ReportLineRow key={line.taxDefinitionId} code={`${(line.rate * 100).toFixed(0)}%`} name={line.name} amount={line.amount} />
              ))}
              <ThemedText type="smallBold">Input VAT (purchases)</ThemedText>
              {vatReturn.inputVat.map((line) => (
                <ReportLineRow key={line.taxDefinitionId} code={`${(line.rate * 100).toFixed(0)}%`} name={line.name} amount={line.amount} />
              ))}
              <View style={styles.totals}>
                <ThemedText type="small" themeColor="textSecondary">
                  Total output VAT: {vatReturn.totalOutputVat.toFixed(2)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Total input VAT: {vatReturn.totalInputVat.toFixed(2)}
                </ThemedText>
                <ThemedText type="smallBold">Net VAT due: {vatReturn.netVatDue.toFixed(2)}</ThemedText>
              </View>
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  reportSection: {
    gap: Spacing.two,
  },
  reportLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totals: {
    gap: Spacing.half,
    alignItems: 'flex-end',
    marginTop: Spacing.two,
  },
});
