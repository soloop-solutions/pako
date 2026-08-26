import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type BadgeProps = {
  label: string;
  variant?: 'default' | 'secondary';
};

export function Badge({ label, variant = 'secondary' }: BadgeProps) {
  const theme = useTheme();
  const backgroundColor = variant === 'default' ? theme.tint : theme.backgroundElement;
  const textColor = variant === 'default' ? theme.tintText : theme.text;

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <ThemedText type="small" style={{ color: textColor }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
});
