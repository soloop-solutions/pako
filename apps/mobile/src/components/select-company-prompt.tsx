import { Link } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';

export function SelectCompanyPrompt({ title, description }: { title: string; description: string }) {
  return (
    <Screen>
      <Card>
        <CardHeader title={title} description={description} />
        <Link href="/companies" asChild>
          <Button title="Select or create a company" />
        </Link>
      </Card>
    </Screen>
  );
}
