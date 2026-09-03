import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SelectOption = { label: string; value: string };

type SelectFieldProps = {
  label: string;
  value: string;
  options: SelectOption[];
  placeholder?: string;
  onChange: (value: string) => void;
};

export function SelectField({ label, value, options, placeholder, onChange }: SelectFieldProps) {
  const theme = useTheme();
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  const resolvedPlaceholder = placeholder ?? intl.formatMessage({ id: 'select.placeholder' });

  return (
    <View style={styles.container}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.input, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
      >
        <ThemedText themeColor={selected ? 'text' : 'textSecondary'}>{selected?.label ?? resolvedPlaceholder}</ThemedText>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <ThemedText type="smallBold" style={styles.sheetTitle}>
              {label}
            </ThemedText>
            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              style={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  style={[styles.option, item.value === value && { backgroundColor: theme.backgroundSelected }]}
                >
                  <ThemedText>{item.label}</ThemedText>
                </Pressable>
              )}
              ListEmptyComponent={
                <ThemedText themeColor="textSecondary" style={styles.option}>
                  {intl.formatMessage({ id: 'select.noOptions' })}
                </ThemedText>
              }
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  sheetTitle: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.two,
  },
  option: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: 8,
  },
});
