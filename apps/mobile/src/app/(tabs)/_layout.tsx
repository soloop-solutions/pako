import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useIntl } from 'react-intl';

import { useTheme } from '@/hooks/use-theme';

export default function TabLayout() {
  const theme = useTheme();
  const intl = useIntl();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: intl.formatMessage({ id: 'nav.dashboard' }), tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="invoicing"
        options={{
          title: intl.formatMessage({ id: 'nav.invoicing' }),
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: intl.formatMessage({ id: 'nav.bills' }),
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: intl.formatMessage({ id: 'nav.reports' }), tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: intl.formatMessage({ id: 'nav.settings' }), tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
