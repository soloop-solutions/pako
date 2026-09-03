import { Link } from 'expo-router';
import { useIntl } from 'react-intl';

import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';

export function SelectCompanyPrompt({ title, description }: { title: string; description: string }) {
  const intl = useIntl();

  return (
    <Screen>
      <Card>
        <CardHeader title={title} description={description} />
        <Link href="/companies" asChild>
          <Button title={intl.formatMessage({ id: 'selectCompany.button' })} />
        </Link>
      </Card>
    </Screen>
  );
}
