import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
      setError(getApiErrorMessage(err, 'Could not create your account.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="title">PAKO</ThemedText>
        <ThemedText themeColor="textSecondary">Create your account</ThemedText>
      </View>

      {error && <ErrorBanner message={error} />}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password-new" />

      <Button
        title={submitting ? 'Creating account...' : 'Create account'}
        onPress={handleSubmit}
        loading={submitting}
        disabled={!email || !password}
      />

      <Link href="/login" asChild>
        <Pressable>
          <ThemedText type="linkPrimary" style={styles.link}>
            Already have an account? Sign in
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
