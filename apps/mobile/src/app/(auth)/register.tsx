import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { getApiErrorMessage } from '@/api/client';
import { useAuth } from '@/context/auth-context';

export default function RegisterScreen() {
  const { register } = useAuth();
  const intl = useIntl();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await register(email.trim(), password);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'auth.createAccountError' })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="title">{intl.formatMessage({ id: 'auth.pako' })}</ThemedText>
        <ThemedText themeColor="textSecondary">{intl.formatMessage({ id: 'auth.createAccountSubtitle' })}</ThemedText>
      </View>

      {error && <ErrorBanner message={error} />}

      <TextField
        label={intl.formatMessage({ id: 'auth.email' })}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <TextField label={intl.formatMessage({ id: 'auth.password' })} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password-new" />

      <Button
        title={submitting ? intl.formatMessage({ id: 'auth.creatingAccount' }) : intl.formatMessage({ id: 'auth.createAccount' })}
        onPress={handleSubmit}
        loading={submitting}
        disabled={!email || !password}
      />

      <Link href="/login" asChild>
        <Pressable>
          <ThemedText type="linkPrimary" style={styles.link}>
            {intl.formatMessage({ id: 'auth.hasAccount' })}
          </ThemedText>
        </Pressable>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'center',
    flexGrow: 1,
  },
  header: {
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  link: {
    textAlign: 'center',
  },
});
