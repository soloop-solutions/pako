import { Stack } from 'expo-router';
import { useIntl } from 'react-intl';

import { useTheme } from '@/hooks/use-theme';

export default function InvoicingLayout() {
  const theme = useTheme();
  const intl = useIntl();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
      }}>
      <Stack.Screen name="index" options={{ title: intl.formatMessage({ id: 'invoicing.title' }) }} />
      <Stack.Screen name="new" options={{ title: intl.formatMessage({ id: 'invoicing.newInvoice' }) }} />
      <Stack.Screen name="[id]" options={{ title: intl.formatMessage({ id: 'invoicing.invoice' }) }} />
    </Stack>
  );
}
