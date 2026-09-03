import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';
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
import { SuccessBanner } from '@/components/ui/success-banner';
import { ApplyDocumentForm } from '@/components/shared/apply-document-form';
import { RecordPaymentForm } from '@/components/shared/record-payment-form';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';
import { INVOICE_DOCUMENT_TYPE_CREDIT_NOTE, INVOICE_DOCUMENT_TYPE_DOWN_PAYMENT, invoiceDocumentTypeLabel } from '@/lib/document-enums';
import { isCashOrBankAccountSubType } from '@/lib/ledger-enums';
import { computeFromGross, lineGrossAmount } from '@/lib/tax-enums';
import type { ApplyDocumentCandidate } from '@/components/shared/apply-document-form';

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const intl = useIntl();

  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [balance, setBalance] = useState<DocumentBalanceResponse | null>(null);
  const [creditNoteCandidates, setCreditNoteCandidates] = useState<ApplyDocumentCandidate[]>([]);
  const [downPaymentCandidates, setDownPaymentCandidates] = useState<ApplyDocumentCandidate[]>([]);
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
      const [invoiceResult, partnersResult, taxesResult, accountsResult, allInvoicesResult] = await Promise.all([
        apiClient.invoicesGET(companyId, id),
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.accounts(companyId),
        apiClient.invoicesAll(companyId),
      ]);
      setInvoice(invoiceResult);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setAccounts(accountsResult);

      if (invoiceResult.state === 'Posted') {
        setBalance(await apiClient.balance2(companyId, id));

        const candidatesOfType = (documentType: number) =>
          allInvoicesResult.filter(
            (candidate) =>
              candidate.id !== invoiceResult.id &&
              candidate.partnerId === invoiceResult.partnerId &&
              candidate.documentType === documentType &&
              candidate.state === 'Posted',
          );
        const withBalances = async (documentType: number, fallbackLabel: string): Promise<ApplyDocumentCandidate[]> => {
          const candidates = candidatesOfType(documentType);
          const balances = await Promise.all(candidates.map((candidate) => apiClient.balance2(companyId, candidate.id)));
          return candidates
            .map((candidate, index) => ({
              id: candidate.id,
              label: `${candidate.invoiceNumber ?? fallbackLabel} · ${balances[index].outstanding.toFixed(2)}`,
              availableAmount: balances[index].outstanding,
            }))
            .filter((candidate) => candidate.availableAmount > 0);
        };

        setCreditNoteCandidates(await withBalances(INVOICE_DOCUMENT_TYPE_CREDIT_NOTE, intl.formatMessage({ id: 'applyDocument.creditNote' })));
        setDownPaymentCandidates(await withBalances(INVOICE_DOCUMENT_TYPE_DOWN_PAYMENT, intl.formatMessage({ id: 'applyDocument.downPayment' })));
      } else {
        setBalance(null);
        setCreditNoteCandidates([]);
        setDownPaymentCandidates([]);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'invoiceDetail.loadError' })));
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
      await apiClient.post2(companyId, id);
      await refresh();
    } catch (err) {
      setPostError(getApiErrorMessage(err, intl.formatMessage({ id: 'invoiceDetail.postError' })));
    } finally {
      setPosting(false);
    }
  }

  if (!activeCompany || !invoice) {
    return (
      <Screen>
        {error ? <ErrorBanner message={error} /> : <ThemedText themeColor="textSecondary">{intl.formatMessage({ id: 'invoiceDetail.loading' })}</ThemedText>}
      </Screen>
    );
  }

  const partner = partners.find((p) => p.id === invoice.partnerId);
  const cashAccounts = accounts.filter((a) => isCashOrBankAccountSubType(a.accountSubType));

  let total = 0;
  let estimatedNet = 0;
  let estimatedTax = 0;
  for (const line of invoice.lines) {
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
            <ThemedText type="subtitle">{invoice.invoiceNumber ?? intl.formatMessage({ id: 'invoicing.draftInvoice' })}</ThemedText>
            <ThemedText themeColor="textSecondary">{partner?.name ?? invoice.partnerId}</ThemedText>
          </View>
          <View style={styles.badgeGroup}>
            <Badge label={invoiceDocumentTypeLabel(invoice.documentType, intl)} />
            <Badge label={invoice.state === 'Posted' ? intl.formatMessage({ id: 'common.posted' }) : intl.formatMessage({ id: 'common.draft' })} variant={invoice.state === 'Posted' ? 'default' : 'secondary'} />
          </View>
        </View>

        <View style={styles.metaRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {intl.formatMessage({ id: 'invoiceDetail.issueDate' })} {invoice.issueDate}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {intl.formatMessage({ id: 'invoiceDetail.dueDate' })} {invoice.dueDate}
          </ThemedText>
        </View>

        <View style={styles.lines}>
          {invoice.lines.map((line) => {
            const gross = lineGrossAmount(line.quantity, line.unitPrice, line.discountPercent);
            const { net } = computeFromGross(gross, taxes.find((t) => t.id === line.taxDefinitionId));
            return (
              <View key={line.id} style={styles.line}>
                <ThemedText type="smallBold">{line.description}</ThemedText>
                <View style={styles.lineMeta}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {line.quantity} x {line.unitPrice.toFixed(2)} ({intl.formatMessage({ id: 'invoiceDetail.inclVat' })})
                    {line.discountPercent > 0 ? ` − ${line.discountPercent}%` : ''} - {taxes.find((t) => t.id === line.taxDefinitionId)?.name ?? intl.formatMessage({ id: 'invoiceDetail.noTax' })}
                  </ThemedText>
                  <ThemedText type="small">{intl.formatMessage({ id: 'common.net' })}: {net.toFixed(2)} · {intl.formatMessage({ id: 'common.total' })}: {gross.toFixed(2)}</ThemedText>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.totals}>
          <ThemedText type="small" themeColor="textSecondary">
            {intl.formatMessage({ id: 'invoiceDetail.netExclVat' })}: {estimatedNet.toFixed(2)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {intl.formatMessage({ id: 'invoiceDetail.vat' })}: {estimatedTax.toFixed(2)}
          </ThemedText>
          <ThemedText type="smallBold">{intl.formatMessage({ id: 'invoiceDetail.total' })}: {total.toFixed(2)}</ThemedText>
        </View>

        {invoice.state === 'Draft' && (
          <View style={styles.postSection}>
            <Button title={posting ? intl.formatMessage({ id: 'invoiceDetail.posting' }) : intl.formatMessage({ id: 'invoiceDetail.postInvoice' })} onPress={handlePost} loading={posting} />
            {postError && <ErrorBanner message={postError} />}
          </View>
        )}

        {invoice.state === 'Posted' && balance && (
          <View style={styles.balanceRow}>
            <ThemedText type="small">{intl.formatMessage({ id: 'invoiceDetail.total' })}: {balance.total.toFixed(2)}</ThemedText>
            <ThemedText type="small">{intl.formatMessage({ id: 'invoiceDetail.reconciled' })}: {balance.reconciled.toFixed(2)}</ThemedText>
            <ThemedText type="smallBold">{intl.formatMessage({ id: 'invoicing.outstanding' })}: {balance.outstanding.toFixed(2)}</ThemedText>
          </View>
        )}
      </Card>

      {invoice.state === 'Posted' && balance && balance.outstanding > 0 && (
        <Card>
          <CardHeader title={intl.formatMessage({ id: 'recordPayment.title' })} description={intl.formatMessage({ id: 'recordPayment.invoiceDescription' })} />
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

      {invoice.state === 'Posted' && balance && balance.outstanding > 0 && creditNoteCandidates.length > 0 && (
        <Card>
          <CardHeader title={intl.formatMessage({ id: 'applyDocument.creditNoteTitle' })} description={intl.formatMessage({ id: 'applyDocument.creditNoteInvoiceDescription' })} />
          <ApplyDocumentForm
            companyId={activeCompany.id}
            documentKind="invoice"
            applyKind="credit-note"
            documentId={invoice.id}
            candidates={creditNoteCandidates}
            outstanding={balance.outstanding}
            onApplied={async (message) => {
              await refresh();
              setApplyMessage(message);
            }}
          />
        </Card>
      )}

      {invoice.state === 'Posted' && balance && balance.outstanding > 0 && downPaymentCandidates.length > 0 && (
        <Card>
          <CardHeader
            title={intl.formatMessage({ id: 'applyDocument.downPaymentTitle' })}
            description={intl.formatMessage({ id: 'applyDocument.downPaymentDescription' })}
          />
          <ApplyDocumentForm
            companyId={activeCompany.id}
            documentKind="invoice"
            applyKind="down-payment"
            documentId={invoice.id}
            candidates={downPaymentCandidates}
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
