import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';
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
import { computeFromGross, lineGrossAmount } from '@/lib/tax-enums';
import type { ApplyDocumentCandidate } from '@/components/shared/apply-document-form';

export default function BillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const intl = useIntl();

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
              label: `${candidate.vendorReference ?? intl.formatMessage({ id: 'applyDocument.creditNote' })} · ${balances[index].outstanding.toFixed(2)}`,
              availableAmount: balances[index].outstanding,
            }))
            .filter((candidate) => candidate.availableAmount > 0),
        );
      } else {
        setBalance(null);
        setCreditNoteCandidates([]);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'billDetail.loadError' })));
    } finally {
      setRefreshing(false);
    }
  }, [companyId, id, intl]);

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
      setPostError(getApiErrorMessage(err, intl.formatMessage({ id: 'billDetail.postError' })));
    } finally {
      setPosting(false);
    }
  }

  if (!activeCompany || !bill) {
    return (
      <Screen>
        {error ? <ErrorBanner message={error} /> : <ThemedText themeColor="textSecondary">{intl.formatMessage({ id: 'billDetail.loading' })}</ThemedText>}
      </Screen>
    );
  }

  const partner = partners.find((p) => p.id === bill.partnerId);
  const cashAccounts = accounts.filter((a) => isCashOrBankAccountSubType(a.accountSubType));

  let total = 0;
  let estimatedNet = 0;
  let estimatedTax = 0;
  for (const line of bill.lines) {
    const gross = lineGrossAmount(line.quantity, line.unitPrice, line.discountPercent);
    total += gross;
    const { net, tax } = computeFromGross(gross, taxes.find((t) => t.id === line.taxDefinitionId));
    estimatedNet += net;
    estimatedTax += tax;
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      {error && <ErrorBanner message={error} />}
      {applyMessage && <SuccessBanner message={applyMessage} />}

      <Card>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <ThemedText type="subtitle">{bill.vendorReference ?? intl.formatMessage({ id: 'bills.draftBill' })}</ThemedText>
            <ThemedText themeColor="textSecondary">{partner?.name ?? bill.partnerId}</ThemedText>
          </View>
          <View style={styles.badgeGroup}>
            <Badge label={billDocumentTypeLabel(bill.documentType, intl)} />
            <Badge label={bill.state === 'Posted' ? intl.formatMessage({ id: 'common.posted' }) : intl.formatMessage({ id: 'common.draft' })} variant={bill.state === 'Posted' ? 'default' : 'secondary'} />
          </View>
        </View>

        <View style={styles.metaRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {intl.formatMessage({ id: 'billDetail.issueDate' })} {bill.issueDate}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {intl.formatMessage({ id: 'billDetail.dueDate' })} {bill.dueDate}
          </ThemedText>
        </View>

        <View style={styles.lines}>
          {bill.lines.map((line) => {
            const gross = lineGrossAmount(line.quantity, line.unitPrice, line.discountPercent);
            const { net } = computeFromGross(gross, taxes.find((t) => t.id === line.taxDefinitionId));
            return (
              <View key={line.id} style={styles.line}>
                <ThemedText type="smallBold">{line.description}</ThemedText>
                <View style={styles.lineMeta}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {line.quantity} x {line.unitPrice.toFixed(2)} ({intl.formatMessage({ id: 'billDetail.inclVat' })})
                    {line.discountPercent > 0 ? ` − ${line.discountPercent}%` : ''} - {taxes.find((t) => t.id === line.taxDefinitionId)?.name ?? intl.formatMessage({ id: 'billDetail.noTax' })}
                  </ThemedText>
                  <ThemedText type="small">{intl.formatMessage({ id: 'common.net' })}: {net.toFixed(2)} · {intl.formatMessage({ id: 'common.total' })}: {gross.toFixed(2)}</ThemedText>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.totals}>
          <ThemedText type="small" themeColor="textSecondary">
            {intl.formatMessage({ id: 'billDetail.netExclVat' })}: {estimatedNet.toFixed(2)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {intl.formatMessage({ id: 'billDetail.vat' })}: {estimatedTax.toFixed(2)}
          </ThemedText>
          <ThemedText type="smallBold">{intl.formatMessage({ id: 'billDetail.total' })}: {total.toFixed(2)}</ThemedText>
        </View>

        {bill.state === 'Draft' && (
          <View style={styles.postSection}>
            <Button title={posting ? intl.formatMessage({ id: 'billDetail.posting' }) : intl.formatMessage({ id: 'billDetail.postBill' })} onPress={handlePost} loading={posting} />
            {postError && <ErrorBanner message={postError} />}
          </View>
        )}

        {bill.state === 'Posted' && balance && (
          <View style={styles.balanceRow}>
            <ThemedText type="small">{intl.formatMessage({ id: 'billDetail.total' })}: {balance.total.toFixed(2)}</ThemedText>
            <ThemedText type="small">{intl.formatMessage({ id: 'billDetail.reconciled' })}: {balance.reconciled.toFixed(2)}</ThemedText>
            <ThemedText type="smallBold">{intl.formatMessage({ id: 'bills.outstanding' })}: {balance.outstanding.toFixed(2)}</ThemedText>
          </View>
        )}
      </Card>

      {bill.state === 'Posted' && balance && balance.outstanding > 0 && (
        <Card>
          <CardHeader title={intl.formatMessage({ id: 'recordPayment.title' })} description={intl.formatMessage({ id: 'recordPayment.billDescription' })} />
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
          <CardHeader title={intl.formatMessage({ id: 'applyDocument.creditNoteTitle' })} description={intl.formatMessage({ id: 'applyDocument.creditNoteBillDescription' })} />
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
