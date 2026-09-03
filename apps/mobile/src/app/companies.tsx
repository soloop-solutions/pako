import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIntl } from 'react-intl';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';

export default function CompaniesScreen() {
  const { companies, activeCompanyId, loading, error, setActiveCompanyId, createCompany, refresh } = useCompany();
  const intl = useIntl();
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreateError(null);
    setCreating(true);
    try {
      await createCompany(name.trim());
      setName('');
    } catch (err) {
      setCreateError(getApiErrorMessage(err, intl.formatMessage({ id: 'companies.createError' })));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen onRefresh={refresh} refreshing={loading}>
      <Card>
        <CardHeader title={intl.formatMessage({ id: 'companies.title' })} description={intl.formatMessage({ id: 'companies.description' })} />
        {error && <ErrorBanner message={error} />}
        {loading && companies.length === 0 && (
          <ThemedText themeColor="textSecondary">{intl.formatMessage({ id: 'companies.loading' })}</ThemedText>
        )}
        {!loading && companies.length === 0 && !error && (
          <ThemedText themeColor="textSecondary">{intl.formatMessage({ id: 'companies.empty' })}</ThemedText>
        )}
        {companies.map((company) => {
          const isActive = company.id === activeCompanyId;
          return (
            <View key={company.id} style={styles.row}>
              <View style={styles.rowLabel}>
                <ThemedText type="smallBold">{company.name}</ThemedText>
                {isActive && <Badge label={intl.formatMessage({ id: 'companies.active' })} variant="default" />}
              </View>
              <Button
                title={isActive ? intl.formatMessage({ id: 'companies.active' }) : intl.formatMessage({ id: 'companies.setActive' })}
                variant={isActive ? 'ghost' : 'outline'}
                disabled={isActive}
                onPress={() => setActiveCompanyId(company.id)}
              />
            </View>
          );
        })}
      </Card>

      <Card>
        <CardHeader title={intl.formatMessage({ id: 'companies.createTitle' })} description={intl.formatMessage({ id: 'companies.createDescription' })} />
        <TextField label={intl.formatMessage({ id: 'companies.nameLabel' })} value={name} onChangeText={setName} autoCapitalize="words" />
        <Button title={creating ? intl.formatMessage({ id: 'companies.creating' }) : intl.formatMessage({ id: 'companies.createButton' })} onPress={handleCreate} loading={creating} disabled={name.trim().length === 0} />
        {createError && <ErrorBanner message={createError} />}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
});
