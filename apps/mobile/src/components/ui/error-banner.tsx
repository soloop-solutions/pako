import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ErrorBanner({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { borderColor: theme.danger }]}>
      <ThemedText type="small" style={{ color: theme.danger }}>
        {message}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 8,
    padding: Spacing.three,
  },
});
