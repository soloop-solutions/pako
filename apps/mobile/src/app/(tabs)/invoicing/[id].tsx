import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  AccountResponse,
  DocumentBalanceResponse,
  InvoiceResponse,
  PartnerResponse,
  TaxDefinitionResponse,
} from '@pako/shared';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { RecordPaymentForm } from '@/components/shared/record-payment-form';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';
import { isCashOrBankAccountSubType } from '@/lib/ledger-enums';
import { estimatedTaxAmount } from '@/lib/tax-enums';

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [balance, setBalance] = useState<DocumentBalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId || !id) return;
    setError(null);
    setRefreshing(true);
    try {
      const [invoiceResult, partnersResult, taxesResult, accountsResult] = await Promise.all([
        apiClient.invoicesGET(companyId, id),
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.accounts(companyId),
      ]);
      setInvoice(invoiceResult);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setAccounts(accountsResult);

      if (invoiceResult.state === 'Posted') {
        setBalance(await apiClient.balance2(companyId, id));
      } else {
        setBalance(null);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the invoice.'));
    } finally {
      setRefreshing(false);
    }
  }, [companyId, id]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  async function handlePost() {
    if (!companyId || !id) return;
    setPostError(null);
    setPosting(true);
    try {
      await apiClient.post2(companyId, id);
      await refresh();
    } catch (err) {
      setPostError(getApiErrorMessage(err, 'Could not post this invoice.'));
    } finally {
      setPosting(false);
    }
  }

  if (!activeCompany || !invoice) {
    return (
      <Screen>
        {error ? <ErrorBanner message={error} /> : <ThemedText themeColor="textSecondary">Loading...</ThemedText>}
      </Screen>
    );
  }

  const partner = partners.find((p) => p.id === invoice.partnerId);
  const cashAccounts = accounts.filter((a) => isCashOrBankAccountSubType(a.accountSubType));

  let subtotal = 0;
  let estimatedTax = 0;
  for (const line of invoice.lines) {
    const net = line.quantity * line.unitPrice;
    subtotal += net;
    estimatedTax += estimatedTaxAmount(net, taxes.find((t) => t.id === line.taxDefinitionId));
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <ThemedText type="subtitle">{invoice.invoiceNumber ?? 'Draft invoice'}</ThemedText>
            <ThemedText themeColor="textSecondary">{partner?.name ?? invoice.partnerId}</ThemedText>
          </View>
          <Badge label={invoice.state} variant={invoice.state === 'Posted' ? 'default' : 'secondary'} />
        </View>

        <View style={styles.metaRow}>
          <ThemedText type="small" themeColor="textSecondary">
            Issue date: {invoice.issueDate}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Due date: {invoice.dueDate}
          </ThemedText>
        </View>

        <View style={styles.lines}>
          {invoice.lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <ThemedText type="smallBold">{line.description}</ThemedText>
              <View style={styles.lineMeta}>
                <ThemedText type="small" themeColor="textSecondary">
                  {line.quantity} x {line.unitPrice.toFixed(2)} - {taxes.find((t) => t.id === line.taxDefinitionId)?.name ?? 'No tax'}
                </ThemedText>
                <ThemedText type="small">{(line.quantity * line.unitPrice).toFixed(2)}</ThemedText>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <ThemedText type="small" themeColor="textSecondary">
            Subtotal: {subtotal.toFixed(2)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Estimated tax: {estimatedTax.toFixed(2)}
          </ThemedText>
          <ThemedText type="smallBold">Estimated total: {(subtotal + estimatedTax).toFixed(2)}</ThemedText>
        </View>

        {invoice.state === 'Draft' && (
          <View style={styles.postSection}>
            <Button title={posting ? 'Posting...' : 'Post invoice'} onPress={handlePost} loading={posting} />
            {postError && <ErrorBanner message={postError} />}
          </View>
        )}

        {invoice.state === 'Posted' && balance && (
          <View style={styles.balanceRow}>
            <ThemedText type="small">Total: {balance.total.toFixed(2)}</ThemedText>
            <ThemedText type="small">Reconciled: {balance.reconciled.toFixed(2)}</ThemedText>
            <ThemedText type="smallBold">Outstanding: {balance.outstanding.toFixed(2)}</ThemedText>
          </View>
        )}
      </Card>

      {invoice.state === 'Posted' && balance && balance.outstanding > 0 && (
        <Card>
          <CardHeader title="Record payment" description="Creates and posts the settlement entry, then reconciles it against this invoice." />
          <RecordPaymentForm
            companyId={activeCompany.id}
            documentKind="invoice"
            documentId={invoice.id}
            cashAccounts={cashAccounts}
            outstanding={balance.outstanding}
            onRecorded={refresh}
          />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleText: {
    gap: Spacing.half,
    flexShrink: 1,
  },
  metaRow: {
    gap: Spacing.half,
  },
  lines: {
    gap: Spacing.three,
  },
  line: {
    gap: Spacing.one,
  },
  lineMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totals: {
    gap: Spacing.half,
    alignItems: 'flex-end',
  },
  postSection: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  balanceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
});
