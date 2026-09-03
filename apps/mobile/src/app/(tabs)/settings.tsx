import { Link } from 'expo-router';
import { useIntl } from 'react-intl';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { SelectField } from '@/components/ui/select-field';
import { useAuth } from '@/context/auth-context';
import { useCompany } from '@/context/company-context';
import { useLocale } from '@/i18n/IntlProviderWrapper';

export default function SettingsScreen() {
  const { auth, logout } = useAuth();
  const { activeCompany } = useCompany();
  const intl = useIntl();
  const { locale, setLocale } = useLocale();

  const languageOptions = [
    { value: 'en', label: intl.formatMessage({ id: 'settings.english' }) },
    { value: 'sq', label: intl.formatMessage({ id: 'settings.albanian' }) },
  ];

  return (
    <Screen>
      <Card>
        <CardHeader title={intl.formatMessage({ id: 'settings.account' })} description={auth?.email} />
        <Button title={intl.formatMessage({ id: 'auth.logOut' })} variant="danger" onPress={logout} />
      </Card>

      <Card>
        <CardHeader title={intl.formatMessage({ id: 'settings.company' })} description={activeCompany ? activeCompany.name : intl.formatMessage({ id: 'settings.noCompany' })} />
        <Link href="/companies" asChild>
          <Button title={intl.formatMessage({ id: 'settings.switchOrCreate' })} variant="outline" />
        </Link>
      </Card>

      <Card>
        <SelectField
          label={intl.formatMessage({ id: 'settings.language' })}
          value={locale}
          onChange={setLocale}
          options={languageOptions}
        />
      </Card>

      <ThemedText type="small" themeColor="textSecondary">
        {intl.formatMessage({ id: 'settings.payrollNote' })}
      </ThemedText>
    </Screen>
  );
}
