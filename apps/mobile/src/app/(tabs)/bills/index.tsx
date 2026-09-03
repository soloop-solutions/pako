import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';
import type { BillResponse, DocumentBalanceResponse, PartnerResponse } from '@pako/shared';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { PartnerForm } from '@/components/shared/partner-form';
import { SelectCompanyPrompt } from '@/components/select-company-prompt';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';
import { useTheme } from '@/hooks/use-theme';
import { billDocumentTypeLabel } from '@/lib/document-enums';

export default function BillsScreen() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const theme = useTheme();
  const intl = useIntl();

  const [vendors, setVendors] = useState<PartnerResponse[]>([]);
  const [bills, setBills] = useState<BillResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    setRefreshing(true);
    try {
      const [partnersResult, billsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.billsAll(companyId),
      ]);
      setVendors(partnersResult.filter((p) => p.isVendor));
      setBills(billsResult);

      const balanceEntries = await Promise.all(
        billsResult.map(async (bill) => [bill.id, await apiClient.balance(companyId, bill.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'bills.loadError' })));
    } finally {
      setRefreshing(false);
    }
  }, [companyId, intl]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (!activeCompany) {
    return <SelectCompanyPrompt title={intl.formatMessage({ id: 'bills.title' })} description={intl.formatMessage({ id: 'selectCompany.billsDescription' })} />;
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      data={bills}
      keyExtractor={(item) => item.id}
      onRefresh={refresh}
      refreshing={refreshing}
      renderItem={({ item }) => (
        <Link href={`/bills/${item.id}`} asChild>
          <Pressable>
            <Card style={styles.billRow}>
              <View style={styles.billRowTop}>
                <ThemedText type="smallBold">{item.vendorReference ?? intl.formatMessage({ id: 'bills.bill' })}</ThemedText>
                <View style={styles.badgeGroup}>
                  <Badge label={billDocumentTypeLabel(item.documentType, intl)} />
                  <Badge label={item.state === 'Posted' ? intl.formatMessage({ id: 'common.posted' }) : intl.formatMessage({ id: 'common.draft' })} variant={item.state === 'Posted' ? 'default' : 'secondary'} />
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {vendors.find((v) => v.id === item.partnerId)?.name ?? item.partnerId}
              </ThemedText>
              <View style={styles.billRowBottom}>
                <ThemedText type="small" themeColor="textSecondary">
                  {intl.formatMessage({ id: 'bills.due' })} {item.dueDate}
                </ThemedText>
                <ThemedText type="smallBold">
                  {item.state === 'Posted' ? `${intl.formatMessage({ id: 'bills.outstanding' })} ${balances[item.id]?.outstanding.toFixed(2) ?? '...'}` : '-'}
                </ThemedText>
              </View>
            </Card>
          </Pressable>
        </Link>
      )}
      ListHeaderComponent={
        <View style={styles.header}>
          {error && <ErrorBanner message={error} />}

          <Card>
            <CardHeader title={intl.formatMessage({ id: 'bills.vendors' })} description={activeCompany.name} />
            <PartnerForm companyId={activeCompany.id} role="vendor" onCreated={refresh} />
            {vendors.length > 0 && (
              <View style={styles.chips}>
                {vendors.map((vendor) => (
                  <Badge key={vendor.id} label={vendor.name} />
                ))}
              </View>
            )}
          </Card>

          <Link href="/bills/new" asChild>
            <Button title={intl.formatMessage({ id: 'bills.newBillButton' })} disabled={vendors.length === 0} />
          </Link>

          <ThemedText type="smallBold">{intl.formatMessage({ id: 'bills.billsLabel' })}</ThemedText>
        </View>
      }
      ListEmptyComponent={
        <ThemedText themeColor="textSecondary" style={styles.empty}>
          {intl.formatMessage({ id: 'bills.noBills' })}
        </ThemedText>
      }
      ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.four,
    marginBottom: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  billRow: {
    gap: Spacing.two,
  },
  billRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeGroup: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  billRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
});
