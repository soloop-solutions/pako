import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function BillsLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
      }}>
      <Stack.Screen name="index" options={{ title: 'Bills' }} />
      <Stack.Screen name="new" options={{ title: 'New Bill' }} />
      <Stack.Screen name="[id]" options={{ title: 'Bill' }} />
    </Stack>
  );
}
