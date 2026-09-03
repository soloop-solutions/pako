import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';
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
  const intl = useIntl();

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

  const TABS: { key: Tab; label: string }[] = [
    { key: 'pnl', label: intl.formatMessage({ id: 'reports.pnl' }) },
    { key: 'balance-sheet', label: intl.formatMessage({ id: 'reports.balanceSheet' }) },
    { key: 'vat', label: intl.formatMessage({ id: 'reports.vatReturn' }) },
  ];

  async function loadPnl() {
    if (!companyId) return;
    setPnlError(null);
    setPnlLoading(true);
    try {
      setPnl(await apiClient.profitAndLoss(companyId, pnlFrom, pnlTo));
    } catch (err) {
      setPnlError(getApiErrorMessage(err, intl.formatMessage({ id: 'reports.pnlError' })));
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
      setBalanceSheetError(getApiErrorMessage(err, intl.formatMessage({ id: 'reports.balanceSheetError' })));
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
      setVatError(getApiErrorMessage(err, intl.formatMessage({ id: 'reports.vatError' })));
    } finally {
      setVatLoading(false);
    }
  }

  if (!activeCompany) {
    return <SelectCompanyPrompt title={intl.formatMessage({ id: 'nav.reports' })} description={intl.formatMessage({ id: 'selectCompany.reportsDescription' })} />;
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
          <CardHeader title={intl.formatMessage({ id: 'reports.profitAndLoss' })} description={activeCompany.name} />
          <TextField label={intl.formatMessage({ id: 'reports.from' })} value={pnlFrom} onChangeText={setPnlFrom} />
          <TextField label={intl.formatMessage({ id: 'reports.to' })} value={pnlTo} onChangeText={setPnlTo} />
          <Button title={pnlLoading ? intl.formatMessage({ id: 'reports.loading' }) : intl.formatMessage({ id: 'reports.runReport' })} onPress={loadPnl} loading={pnlLoading} />

          {pnlError && <ErrorBanner message={pnlError} />}

          {pnl && (
            <View style={styles.reportSection}>
              <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.income' })}</ThemedText>
              {pnl.income.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.expenses' })}</ThemedText>
              {pnl.expenses.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <View style={styles.totals}>
                <ThemedText type="small" themeColor="textSecondary">
                  {intl.formatMessage({ id: 'reports.totalIncome' })}: {pnl.totalIncome.toFixed(2)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {intl.formatMessage({ id: 'reports.totalExpenses' })}: {pnl.totalExpenses.toFixed(2)}
                </ThemedText>
                <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.netIncome' })}: {pnl.netIncome.toFixed(2)}</ThemedText>
              </View>
            </View>
          )}
        </Card>
      )}

      {tab === 'balance-sheet' && (
        <Card>
          <CardHeader title={intl.formatMessage({ id: 'reports.balanceSheet' })} description={activeCompany.name} />
          <TextField label={intl.formatMessage({ id: 'reports.asOf' })} value={asOf} onChangeText={setAsOf} />
          <Button title={balanceSheetLoading ? intl.formatMessage({ id: 'reports.loading' }) : intl.formatMessage({ id: 'reports.runReport' })} onPress={loadBalanceSheet} loading={balanceSheetLoading} />

          {balanceSheetError && <ErrorBanner message={balanceSheetError} />}

          {balanceSheet && (
            <View style={styles.reportSection}>
              <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.assets' })}</ThemedText>
              {balanceSheet.assets.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                {intl.formatMessage({ id: 'reports.totalAssets' })}: {balanceSheet.totalAssets.toFixed(2)}
              </ThemedText>

              <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.liabilities' })}</ThemedText>
              {balanceSheet.liabilities.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                {intl.formatMessage({ id: 'reports.totalLiabilities' })}: {balanceSheet.totalLiabilities.toFixed(2)}
              </ThemedText>

              <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.equity' })}</ThemedText>
              {balanceSheet.equity.map((line) => (
                <ReportLineRow key={line.accountId} code={line.accountCode} name={line.accountName} amount={line.amount} />
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                {intl.formatMessage({ id: 'reports.totalEquity' })}: {balanceSheet.totalEquity.toFixed(2)}
              </ThemedText>

              <ThemedText type="smallBold" style={{ color: balanceSheetOk ? theme.text : theme.danger }}>
                {intl.formatMessage({ id: 'reports.assets' })} ({balanceSheet.totalAssets.toFixed(2)}) = {intl.formatMessage({ id: 'reports.liabilities' })} + {intl.formatMessage({ id: 'reports.equity' })} (
                {(balanceSheet.totalLiabilities + balanceSheet.totalEquity).toFixed(2)})
              </ThemedText>
            </View>
          )}
        </Card>
      )}

      {tab === 'vat' && (
        <Card>
          <CardHeader title={intl.formatMessage({ id: 'reports.vatReturn' })} description={activeCompany.name} />
          <TextField label={intl.formatMessage({ id: 'reports.from' })} value={vatFrom} onChangeText={setVatFrom} />
          <TextField label={intl.formatMessage({ id: 'reports.to' })} value={vatTo} onChangeText={setVatTo} />
          <Button title={vatLoading ? intl.formatMessage({ id: 'reports.loading' }) : intl.formatMessage({ id: 'reports.runReport' })} onPress={loadVatReturn} loading={vatLoading} />

          {vatError && <ErrorBanner message={vatError} />}

          {vatReturn && (
            <View style={styles.reportSection}>
              <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.outputVat' })}</ThemedText>
              {vatReturn.outputVat.map((line) => (
                <ReportLineRow key={line.taxDefinitionId} code={`${(line.rate * 100).toFixed(0)}%`} name={line.name} amount={line.amount} />
              ))}
              <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.inputVat' })}</ThemedText>
              {vatReturn.inputVat.map((line) => (
                <ReportLineRow key={line.taxDefinitionId} code={`${(line.rate * 100).toFixed(0)}%`} name={line.name} amount={line.amount} />
              ))}
              <View style={styles.totals}>
                <ThemedText type="small" themeColor="textSecondary">
                  {intl.formatMessage({ id: 'reports.totalOutputVat' })}: {vatReturn.totalOutputVat.toFixed(2)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {intl.formatMessage({ id: 'reports.totalInputVat' })}: {vatReturn.totalInputVat.toFixed(2)}
                </ThemedText>
                <ThemedText type="smallBold">{intl.formatMessage({ id: 'reports.netVatDue' })}: {vatReturn.netVatDue.toFixed(2)}</ThemedText>
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
