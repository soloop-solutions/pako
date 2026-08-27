import { StyleSheet, View } from 'react-native';
import type { TaxDefinitionResponse } from '@pako/shared';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { lineNetAmount, taxRatePercentLabel } from '@/lib/tax-enums';

export type DocumentLine = { description: string; quantity: string; unitPrice: string; taxDefinitionId: string; discountPercent: string };

export const EMPTY_DOCUMENT_LINE: DocumentLine = { description: '', quantity: '1', unitPrice: '', taxDefinitionId: '', discountPercent: '0' };

type DocumentLinesEditorProps = {
  lines: DocumentLine[];
  taxes: TaxDefinitionResponse[];
  onUpdateLine: (index: number, patch: Partial<DocumentLine>) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
};

export function DocumentLinesEditor({ lines, taxes, onUpdateLine, onAddLine, onRemoveLine }: DocumentLinesEditorProps) {
  return (
    <View style={styles.container}>
      {lines.map((line, index) => {
        const net = lineNetAmount(parseFloat(line.quantity) || 0, parseFloat(line.unitPrice) || 0, parseFloat(line.discountPercent) || 0);
        return (
          <View key={index} style={styles.line}>
            <TextField
              label={`Line ${index + 1} description`}
              value={line.description}
              onChangeText={(value) => onUpdateLine(index, { description: value })}
            />
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextField
                  label="Qty"
                  value={line.quantity}
                  onChangeText={(value) => onUpdateLine(index, { quantity: value })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.rowItem}>
                <TextField
                  label="Unit price"
                  value={line.unitPrice}
                  onChangeText={(value) => onUpdateLine(index, { unitPrice: value })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.rowItem}>
                <TextField
                  label="Discount %"
                  value={line.discountPercent}
                  onChangeText={(value) => onUpdateLine(index, { discountPercent: value })}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Net: {net.toFixed(2)}
            </ThemedText>
            <SelectField
              label="Tax"
              value={line.taxDefinitionId}
              onChange={(value) => onUpdateLine(index, { taxDefinitionId: value })}
              options={taxes.map((tax) => ({ value: tax.id, label: taxRatePercentLabel(tax) }))}
              placeholder="No tax"
            />
            <Button title="Remove line" variant="ghost" onPress={() => onRemoveLine(index)} disabled={lines.length <= 1} />
          </View>
        );
      })}
      <Button title="Add line" variant="outline" onPress={onAddLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  line: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  rowItem: {
    flex: 1,
  },
});
