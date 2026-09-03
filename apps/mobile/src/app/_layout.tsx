import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useIntl } from 'react-intl';

import { AuthProvider, useAuth } from '@/context/auth-context';
import { CompanyProvider } from '@/context/company-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IntlProviderWrapper } from '@/i18n/IntlProviderWrapper';

function RootNavigator() {
  const { auth, ready } = useAuth();
  const intl = useIntl();

  if (!ready) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!auth}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={!!auth}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="companies" options={{ headerShown: true, title: intl.formatMessage({ id: 'companies.title' }), presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <IntlProviderWrapper>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <CompanyProvider>
            <RootNavigator />
          </CompanyProvider>
        </AuthProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </IntlProviderWrapper>
  );
}
