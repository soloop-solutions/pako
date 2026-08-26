import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  AccountResponse,
  BillResponse,
  DocumentBalanceResponse,
  JournalResponse,
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

const ACCOUNTS_PAYABLE_CODE = '2000';

export default function BillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [bill, setBill] = useState<BillResponse | null>(null);
  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [journals, setJournals] = useState<JournalResponse[]>([]);
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
      const [billResult, partnersResult, taxesResult, accountsResult, journalsResult] = await Promise.all([
        apiClient.billsGET(companyId, id),
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.accounts(companyId),
        apiClient.journalsAll(companyId),
      ]);
      setBill(billResult);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setAccounts(accountsResult);
      setJournals(journalsResult);

      if (billResult.state === 'Posted') {
        setBalance(await apiClient.balance(companyId, id));
      } else {
        setBalance(null);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the bill.'));
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
      await apiClient.post(companyId, id);
      await refresh();
    } catch (err) {
      setPostError(getApiErrorMessage(err, 'Could not post this bill.'));
    } finally {
      setPosting(false);
    }
  }

  if (!activeCompany || !bill) {
    return (
      <Screen>
        {error ? <ErrorBanner message={error} /> : <ThemedText themeColor="textSecondary">Loading...</ThemedText>}
      </Screen>
    );
  }

  const partner = partners.find((p) => p.id === bill.partnerId);
  const controlAccount = accounts.find((a) => a.code === ACCOUNTS_PAYABLE_CODE);
  const cashAccounts = accounts.filter((a) => isCashOrBankAccountSubType(a.accountSubType));
  const generalJournal = journals.find((j) => j.code === 'GEN') ?? journals[0];

  let subtotal = 0;
  let estimatedTax = 0;
  for (const line of bill.lines) {
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
            <ThemedText type="subtitle">{bill.vendorReference ?? 'Draft bill'}</ThemedText>
            <ThemedText themeColor="textSecondary">{partner?.name ?? bill.partnerId}</ThemedText>
          </View>
          <Badge label={bill.state} variant={bill.state === 'Posted' ? 'default' : 'secondary'} />
        </View>

        <View style={styles.metaRow}>
          <ThemedText type="small" themeColor="textSecondary">
            Issue date: {bill.issueDate}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Due date: {bill.dueDate}
          </ThemedText>
        </View>

        <View style={styles.lines}>
          {bill.lines.map((line) => (
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

        {bill.state === 'Draft' && (
          <View style={styles.postSection}>
            <Button title={posting ? 'Posting...' : 'Post bill'} onPress={handlePost} loading={posting} />
            {postError && <ErrorBanner message={postError} />}
          </View>
        )}

        {bill.state === 'Posted' && balance && (
          <View style={styles.balanceRow}>
            <ThemedText type="small">Total: {balance.total.toFixed(2)}</ThemedText>
            <ThemedText type="small">Reconciled: {balance.reconciled.toFixed(2)}</ThemedText>
            <ThemedText type="smallBold">Outstanding: {balance.outstanding.toFixed(2)}</ThemedText>
          </View>
        )}
      </Card>

      {bill.state === 'Posted' && balance && balance.outstanding > 0 && controlAccount && generalJournal && (
        <Card>
          <CardHeader title="Record payment" description="Creates and posts the settlement entry, then reconciles it against this bill." />
          <RecordPaymentForm
            companyId={activeCompany.id}
            documentKind="bill"
            documentId={bill.id}
            partnerId={bill.partnerId}
            controlAccountId={controlAccount.id}
            journalId={generalJournal.id}
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
