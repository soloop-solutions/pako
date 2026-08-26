import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
};

export function Button({ title, variant = 'primary', loading, disabled, style, ...rest }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const backgroundColor =
    variant === 'primary' ? theme.tint : variant === 'danger' ? theme.danger : 'transparent';
  const borderColor = variant === 'outline' ? theme.border : 'transparent';
  const textColor = variant === 'primary' || variant === 'danger' ? theme.tintText : theme.tint;

  return (
    <Pressable
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        { backgroundColor, borderColor, borderWidth: variant === 'outline' ? StyleSheet.hairlineWidth * 2 : 0 },
        isDisabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText type="smallBold" style={{ color: textColor }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  disabled: {
    opacity: 0.5,
  },
});
