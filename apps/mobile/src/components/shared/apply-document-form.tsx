import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';

export type ApplyDocumentCandidate = { id: string; label: string; availableAmount: number };

type ApplyDocumentFormProps = {
  companyId: string;
  documentKind: 'invoice' | 'bill';
  applyKind: 'credit-note' | 'down-payment';
  documentId: string;
  candidates: ApplyDocumentCandidate[];
  outstanding: number;
  onApplied: (message: string) => void;
};

export function ApplyDocumentForm({
  companyId,
  documentKind,
  applyKind,
  documentId,
  candidates,
  outstanding,
  onApplied,
}: ApplyDocumentFormProps) {
  const intl = useIntl();
  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function selectCandidate(id: string) {
    setSelectedId(id);
    const candidate = candidates.find((c) => c.id === id);
    const defaultAmount = candidate ? Math.min(candidate.availableAmount, outstanding) : outstanding;
    setAmount(defaultAmount > 0 ? defaultAmount.toFixed(2) : '');
  }

  async function handleSubmit() {
    setError(null);

    if (!selectedId) {
      setError(applyKind === 'credit-note' ? intl.formatMessage({ id: 'applyDocument.selectCreditNote' }) : intl.formatMessage({ id: 'applyDocument.selectDownPayment' }));
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError(intl.formatMessage({ id: 'applyDocument.amountError' }));
      return;
    }

    setSubmitting(true);
    try {
      if (applyKind === 'credit-note') {
        const body = { creditNoteId: selectedId, amount: parsedAmount };
        if (documentKind === 'invoice') {
          await apiClient.applyCreditNote2(companyId, documentId, body);
        } else {
          await apiClient.applyCreditNote(companyId, documentId, body);
        }
        onApplied(intl.formatMessage({ id: 'applyDocument.creditNoteApplied' }));
      } else {
        const result = await apiClient.applyDownPayment(companyId, documentId, {
          downPaymentInvoiceId: selectedId,
          amount: parsedAmount,
        });
        onApplied(`${intl.formatMessage({ id: 'applyDocument.downPaymentApplied' })} ${result.reclassifiedAmount.toFixed(2)} ${intl.formatMessage({ id: 'applyDocument.reclassified' })}`);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'applyDocument.error' })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      {error && <ErrorBanner message={error} />}
      <SelectField
        label={applyKind === 'credit-note' ? intl.formatMessage({ id: 'applyDocument.creditNote' }) : intl.formatMessage({ id: 'applyDocument.downPayment' })}
        value={selectedId}
        onChange={selectCandidate}
        options={candidates.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
        placeholder={intl.formatMessage({ id: 'applyDocument.selectPlaceholder' })}
      />
      <TextField label={intl.formatMessage({ id: 'applyDocument.amount' })} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Button title={submitting ? intl.formatMessage({ id: 'applyDocument.applying' }) : intl.formatMessage({ id: 'applyDocument.apply' })} onPress={handleSubmit} loading={submitting} disabled={candidates.length === 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
});
