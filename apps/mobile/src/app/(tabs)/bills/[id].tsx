import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  AccountResponse,
  BillResponse,
  DocumentBalanceResponse,
  PartnerResponse,
  TaxDefinitionResponse,
} from '@pako/shared';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { SuccessBanner } from '@/components/ui/success-banner';
import { ApplyDocumentForm } from '@/components/shared/apply-document-form';
import { RecordPaymentForm } from '@/components/shared/record-payment-form';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';
import { BILL_DOCUMENT_TYPE_CREDIT_NOTE, billDocumentTypeLabel } from '@/lib/document-enums';
import { isCashOrBankAccountSubType } from '@/lib/ledger-enums';
import { estimatedTaxAmount, lineNetAmount } from '@/lib/tax-enums';
import type { ApplyDocumentCandidate } from '@/components/shared/apply-document-form';

export default function BillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [bill, setBill] = useState<BillResponse | null>(null);
  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [balance, setBalance] = useState<DocumentBalanceResponse | null>(null);
  const [creditNoteCandidates, setCreditNoteCandidates] = useState<ApplyDocumentCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId || !id) return;
    setError(null);
    setApplyMessage(null);
    setRefreshing(true);
    try {
      const [billResult, partnersResult, taxesResult, accountsResult, allBillsResult] = await Promise.all([
        apiClient.billsGET(companyId, id),
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.accounts(companyId),
        apiClient.billsAll(companyId),
      ]);
      setBill(billResult);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setAccounts(accountsResult);

      if (billResult.state === 'Posted') {
        setBalance(await apiClient.balance(companyId, id));

        // The balance endpoint correctly computes remaining capacity for CreditNote documents
        // too (branches on DocumentType server-side) - fetch each candidate's own balance and
        // use its real outstanding amount, not an estimate from its line items.
        const candidates = allBillsResult.filter(
          (candidate) =>
            candidate.id !== billResult.id &&
            candidate.partnerId === billResult.partnerId &&
            candidate.documentType === BILL_DOCUMENT_TYPE_CREDIT_NOTE &&
            candidate.state === 'Posted',
        );
        const balances = await Promise.all(candidates.map((candidate) => apiClient.balance(companyId, candidate.id)));
        setCreditNoteCandidates(
          candidates
            .map((candidate, index) => ({
              id: candidate.id,
              label: `${candidate.vendorReference ?? 'Credit note'} · ${balances[index].outstanding.toFixed(2)}`,
              availableAmount: balances[index].outstanding,
            }))
            .filter((candidate) => candidate.availableAmount > 0),
        );
      } else {
        setBalance(null);
        setCreditNoteCandidates([]);
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
  const cashAccounts = accounts.filter((a) => isCashOrBankAccountSubType(a.accountSubType));

  let subtotal = 0;
  let estimatedTax = 0;
  for (const line of bill.lines) {
    const net = lineNetAmount(line.quantity, line.unitPrice, line.discountPercent);
    subtotal += net;
    estimatedTax += estimatedTaxAmount(net, taxes.find((t) => t.id === line.taxDefinitionId));
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      {error && <ErrorBanner message={error} />}
      {applyMessage && <SuccessBanner message={applyMessage} />}

      <Card>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <ThemedText type="subtitle">{bill.vendorReference ?? 'Draft bill'}</ThemedText>
            <ThemedText themeColor="textSecondary">{partner?.name ?? bill.partnerId}</ThemedText>
          </View>
          <View style={styles.badgeGroup}>
            <Badge label={billDocumentTypeLabel(bill.documentType)} />
            <Badge label={bill.state} variant={bill.state === 'Posted' ? 'default' : 'secondary'} />
          </View>
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
                  {line.quantity} x {line.unitPrice.toFixed(2)}
                  {line.discountPercent > 0 ? ` − ${line.discountPercent}%` : ''} - {taxes.find((t) => t.id === line.taxDefinitionId)?.name ?? 'No tax'}
                </ThemedText>
                <ThemedText type="small">{lineNetAmount(line.quantity, line.unitPrice, line.discountPercent).toFixed(2)}</ThemedText>
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

      {bill.state === 'Posted' && balance && balance.outstanding > 0 && (
        <Card>
          <CardHeader title="Record payment" description="Creates and posts the settlement entry, then reconciles it against this bill." />
          <RecordPaymentForm
            companyId={activeCompany.id}
            documentKind="bill"
            documentId={bill.id}
            cashAccounts={cashAccounts}
            outstanding={balance.outstanding}
            onRecorded={refresh}
          />
        </Card>
      )}

      {bill.state === 'Posted' && balance && balance.outstanding > 0 && creditNoteCandidates.length > 0 && (
        <Card>
          <CardHeader title="Apply credit note" description="Reconciles a posted credit note against this bill's outstanding balance." />
          <ApplyDocumentForm
            companyId={activeCompany.id}
            documentKind="bill"
            applyKind="credit-note"
            documentId={bill.id}
            candidates={creditNoteCandidates}
            outstanding={balance.outstanding}
            onApplied={async (message) => {
              await refresh();
              setApplyMessage(message);
            }}
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
  badgeGroup: {
    flexDirection: 'row',
    gap: Spacing.two,
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
