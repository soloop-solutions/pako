import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import type { DocumentBalanceResponse, InvoiceResponse, PartnerResponse } from '@pako/shared';

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
import { invoiceDocumentTypeLabel } from '@/lib/document-enums';

export default function InvoicingScreen() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const theme = useTheme();

  const [customers, setCustomers] = useState<PartnerResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    setRefreshing(true);
    try {
      const [partnersResult, invoicesResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.invoicesAll(companyId),
      ]);
      setCustomers(partnersResult.filter((p) => p.isCustomer));
      setInvoices(invoicesResult);

      const balanceEntries = await Promise.all(
        invoicesResult.map(async (invoice) => [invoice.id, await apiClient.balance2(companyId, invoice.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load invoicing data.'));
    } finally {
      setRefreshing(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (!activeCompany) {
    return <SelectCompanyPrompt title="Invoicing" description="Select or create a company to manage invoices." />;
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      data={invoices}
      keyExtractor={(item) => item.id}
      onRefresh={refresh}
      refreshing={refreshing}
      renderItem={({ item }) => (
        <Link href={`/invoicing/${item.id}`} asChild>
          <Pressable>
            <Card style={styles.invoiceRow}>
              <View style={styles.invoiceRowTop}>
                <ThemedText type="smallBold">{item.invoiceNumber ?? 'Draft invoice'}</ThemedText>
                <View style={styles.badgeGroup}>
                  <Badge label={invoiceDocumentTypeLabel(item.documentType)} />
                  <Badge label={item.state} variant={item.state === 'Posted' ? 'default' : 'secondary'} />
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {customers.find((c) => c.id === item.partnerId)?.name ?? item.partnerId}
              </ThemedText>
              <View style={styles.invoiceRowBottom}>
                <ThemedText type="small" themeColor="textSecondary">
                  Due {item.dueDate}
                </ThemedText>
                <ThemedText type="smallBold">
                  {item.state === 'Posted' ? `Outstanding ${balances[item.id]?.outstanding.toFixed(2) ?? '...'}` : '-'}
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
            <CardHeader title="Customers" description={activeCompany.name} />
            <PartnerForm companyId={activeCompany.id} role="customer" onCreated={refresh} />
            {customers.length > 0 && (
              <View style={styles.chips}>
                {customers.map((customer) => (
                  <Badge key={customer.id} label={customer.name} />
                ))}
              </View>
            )}
          </Card>

          <Link href="/invoicing/new" asChild>
            <Button title="New invoice" disabled={customers.length === 0} />
          </Link>

          <ThemedText type="smallBold">Invoices</ThemedText>
        </View>
      }
      ListEmptyComponent={
        <ThemedText themeColor="textSecondary" style={styles.empty}>
          No invoices yet.
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
  invoiceRow: {
    gap: Spacing.two,
  },
  invoiceRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeGroup: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  invoiceRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
});
