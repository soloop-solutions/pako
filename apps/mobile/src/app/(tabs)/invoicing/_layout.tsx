import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function InvoicingLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
      }}>
      <Stack.Screen name="index" options={{ title: 'Invoicing' }} />
      <Stack.Screen name="new" options={{ title: 'New Invoice' }} />
      <Stack.Screen name="[id]" options={{ title: 'Invoice' }} />
    </Stack>
  );
}
