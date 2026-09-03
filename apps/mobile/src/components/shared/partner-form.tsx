import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { apiClient, getApiErrorMessage } from '@/api/client';

type PartnerFormProps = {
  companyId: string;
  role: 'customer' | 'vendor';
  onCreated: () => void;
};

export function PartnerForm({ companyId, role, onCreated }: PartnerFormProps) {
  const intl = useIntl();
  const [name, setName] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.partners(companyId, {
        name: name.trim(),
        taxNumber: taxNumber.trim() || undefined,
        isCustomer: role === 'customer',
        isVendor: role === 'vendor',
      });
      setName('');
      setTaxNumber('');
      onCreated();
    } catch (err) {
      setError(getApiErrorMessage(err, `${intl.formatMessage({ id: 'partnerForm.couldNotCreate' })} ${role === 'customer' ? intl.formatMessage({ id: 'invoiceForm.customer' }).toLowerCase() : intl.formatMessage({ id: 'billForm.vendor' }).toLowerCase()}.`));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      {error && <ErrorBanner message={error} />}
      <TextField label={intl.formatMessage({ id: 'partnerForm.name' })} value={name} onChangeText={setName} autoCapitalize="words" />
      <TextField label={intl.formatMessage({ id: 'partnerForm.taxNumber' })} value={taxNumber} onChangeText={setTaxNumber} />
      <Button
        title={submitting ? intl.formatMessage({ id: 'partnerForm.creating' }) : role === 'customer' ? intl.formatMessage({ id: 'partnerForm.addCustomer' }) : intl.formatMessage({ id: 'partnerForm.addVendor' })}
        onPress={handleSubmit}
        loading={submitting}
        disabled={name.trim().length === 0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
});
