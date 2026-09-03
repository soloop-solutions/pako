import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';
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
  const intl = useIntl();
  const [amount, setAmount] = useState(() => outstanding.toFixed(2));
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError(intl.formatMessage({ id: 'recordPayment.amountError' }));
      return;
    }
    if (!cashAccountId) {
      setError(intl.formatMessage({ id: 'recordPayment.accountError' }));
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
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'recordPayment.error' })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      {error && <ErrorBanner message={error} />}
      <TextField label={intl.formatMessage({ id: 'recordPayment.amount' })} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <SelectField
        label={intl.formatMessage({ id: 'recordPayment.cashAccount' })}
        value={cashAccountId}
        onChange={setCashAccountId}
        options={cashAccounts.map((account) => ({ value: account.id, label: `${account.code} - ${account.name}` }))}
        placeholder={intl.formatMessage({ id: 'recordPayment.noAccountsSeeded' })}
      />
      <Button title={submitting ? intl.formatMessage({ id: 'recordPayment.recording' }) : intl.formatMessage({ id: 'recordPayment.recordPayment' })} onPress={handleSubmit} loading={submitting} disabled={cashAccounts.length === 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
});
