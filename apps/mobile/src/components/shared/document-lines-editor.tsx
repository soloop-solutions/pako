import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';
import type { TaxDefinitionResponse } from '@pako/shared';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { computeFromGross, lineGrossAmount, taxRatePercentLabel } from '@/lib/tax-enums';

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
  const intl = useIntl();

  return (
    <View style={styles.container}>
      {lines.map((line, index) => {
        const gross = lineGrossAmount(parseFloat(line.quantity) || 0, parseFloat(line.unitPrice) || 0, parseFloat(line.discountPercent) || 0);
        const { net, tax } = computeFromGross(gross, taxes.find((t) => t.id === line.taxDefinitionId));
        return (
          <View key={index} style={styles.line}>
            <TextField
              label={intl.formatMessage({ id: 'lines.lineDescription' }, { index: index + 1 })}
              value={line.description}
              onChangeText={(value) => onUpdateLine(index, { description: value })}
            />
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextField
                  label={intl.formatMessage({ id: 'lines.qty' })}
                  value={line.quantity}
                  onChangeText={(value) => onUpdateLine(index, { quantity: value })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.rowItem}>
                <TextField
                  label={intl.formatMessage({ id: 'lines.priceInclVat' })}
                  value={line.unitPrice}
                  onChangeText={(value) => onUpdateLine(index, { unitPrice: value })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.rowItem}>
                <TextField
                  label={intl.formatMessage({ id: 'lines.discountPercent' })}
                  value={line.discountPercent}
                  onChangeText={(value) => onUpdateLine(index, { discountPercent: value })}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {intl.formatMessage({ id: 'common.net' })}: {net.toFixed(2)} · {intl.formatMessage({ id: 'invoiceDetail.vat' })}: {tax.toFixed(2)} · {intl.formatMessage({ id: 'common.total' })}: {gross.toFixed(2)}
            </ThemedText>
            <SelectField
              label={intl.formatMessage({ id: 'lines.tax' })}
              value={line.taxDefinitionId}
              onChange={(value) => onUpdateLine(index, { taxDefinitionId: value })}
              options={taxes.map((tax) => ({ value: tax.id, label: taxRatePercentLabel(tax) }))}
              placeholder={intl.formatMessage({ id: 'lines.noTax' })}
            />
            <Button title={intl.formatMessage({ id: 'lines.removeLine' })} variant="ghost" onPress={() => onRemoveLine(index)} disabled={lines.length <= 1} />
          </View>
        );
      })}
      <Button title={intl.formatMessage({ id: 'lines.addLine' })} variant="outline" onPress={onAddLine} />
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
