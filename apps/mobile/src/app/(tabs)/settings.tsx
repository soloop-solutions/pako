import { Link } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/context/auth-context';
import { useCompany } from '@/context/company-context';

export default function SettingsScreen() {
  const { auth, logout } = useAuth();
  const { activeCompany } = useCompany();

  return (
    <Screen>
      <Card>
        <CardHeader title="Account" description={auth?.email} />
        <Button title="Log out" variant="danger" onPress={logout} />
      </Card>

      <Card>
        <CardHeader title="Company" description={activeCompany ? activeCompany.name : 'No company selected'} />
        <Link href="/companies" asChild>
          <Button title="Switch or create company" variant="outline" />
        </Link>
      </Card>

      <ThemedText type="small" themeColor="textSecondary">
        Payroll and standalone reconciliation are managed from the web dashboard. Invoicing and Bills cover recording
        payments on this app.
      </ThemedText>
    </Screen>
  );
}
