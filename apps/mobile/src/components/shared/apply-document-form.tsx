import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
      setError(applyKind === 'credit-note' ? 'Select a credit note.' : 'Select a down payment.');
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError('Enter an amount greater than zero.');
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
        onApplied('Credit note applied.');
      } else {
        const result = await apiClient.applyDownPayment(companyId, documentId, {
          downPaymentInvoiceId: selectedId,
          amount: parsedAmount,
        });
        onApplied(`Down payment applied. ${result.reclassifiedAmount.toFixed(2)} reclassified from deposits to revenue.`);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not apply the document — nothing was changed.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      {error && <ErrorBanner message={error} />}
      <SelectField
        label={applyKind === 'credit-note' ? 'Credit note' : 'Down payment'}
        value={selectedId}
        onChange={selectCandidate}
        options={candidates.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
        placeholder="Select..."
      />
      <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Button title={submitting ? 'Applying...' : 'Apply'} onPress={handleSubmit} loading={submitting} disabled={candidates.length === 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
});
