import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AccountResponse } from '@pako/shared';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';

type RecordPaymentFormProps = {
  companyId: string;
  documentKind: 'invoice' | 'bill';
  documentId: string;
  cashAccounts: AccountResponse[];
  outstanding: number;
  onRecorded: () => void;
};

export function RecordPaymentForm({
  companyId,
  documentKind,
  documentId,
  cashAccounts,
  outstanding,
  onRecorded,
}: RecordPaymentFormProps) {
  const [amount, setAmount] = useState(() => outstanding.toFixed(2));
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    if (!cashAccountId) {
      setError('Select a cash or bank account.');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        amount: parsedAmount,
        cashOrBankAccountId: cashAccountId,
        date: new Date().toISOString().slice(0, 10),
      };
      if (documentKind === 'invoice') {
        await apiClient.recordPayment2(companyId, documentId, body);
      } else {
        await apiClient.recordPayment(companyId, documentId, body);
      }

      onRecorded();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not record the payment — nothing was changed.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      {error && <ErrorBanner message={error} />}
      <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <SelectField
        label="Cash / bank account"
        value={cashAccountId}
        onChange={setCashAccountId}
        options={cashAccounts.map((account) => ({ value: account.id, label: `${account.code} - ${account.name}` }))}
        placeholder="No cash/bank account seeded"
      />
      <Button title={submitting ? 'Recording...' : 'Record payment'} onPress={handleSubmit} loading={submitting} disabled={cashAccounts.length === 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
});
