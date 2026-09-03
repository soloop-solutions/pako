import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';
import type { TrialBalanceLine } from '@pako/shared';

import { ThemedText } from '@/components/themed-text';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { SelectCompanyPrompt } from '@/components/select-company-prompt';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';

export default function DashboardScreen() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const intl = useIntl();

  const [trialBalance, setTrialBalance] = useState<TrialBalanceLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    setRefreshing(true);
    try {
      setTrialBalance(await apiClient.trialBalance(companyId));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'dashboard.loadError' })));
    } finally {
      setRefreshing(false);
    }
  }, [companyId, intl]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  if (!activeCompany) {
    return <SelectCompanyPrompt title={intl.formatMessage({ id: 'nav.dashboard' })} description={intl.formatMessage({ id: 'selectCompany.dashboardDescription' })} />;
  }

  const totalDebit = trialBalance.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = trialBalance.reduce((sum, line) => sum + line.credit, 0);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <CardHeader title={activeCompany.name} description={intl.formatMessage({ id: 'dashboard.trialBalanceDescription' })} />
        <View style={styles.grid}>
          <View style={styles.stat}>
            <ThemedText type="small" themeColor="textSecondary">
              {intl.formatMessage({ id: 'dashboard.accountsWithActivity' })}
            </ThemedText>
            <ThemedText type="subtitle">{trialBalance.length}</ThemedText>
          </View>
          <View style={styles.stat}>
            <ThemedText type="small" themeColor="textSecondary">
              {intl.formatMessage({ id: 'dashboard.totalDebit' })}
            </ThemedText>
            <ThemedText type="subtitle">{totalDebit.toFixed(2)}</ThemedText>
          </View>
          <View style={styles.stat}>
            <ThemedText type="small" themeColor="textSecondary">
              {intl.formatMessage({ id: 'dashboard.totalCredit' })}
            </ThemedText>
            <ThemedText type="subtitle">{totalCredit.toFixed(2)}</ThemedText>
          </View>
        </View>
        {trialBalance.length === 0 && (
          <ThemedText themeColor="textSecondary">{intl.formatMessage({ id: 'dashboard.noActivity' })}</ThemedText>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: Spacing.three,
  },
  stat: {
    gap: Spacing.half,
  },
});
