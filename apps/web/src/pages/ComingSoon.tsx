import { useIntl } from "react-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ComingSoonProps = {
  titleKey: string;
  descriptionKey: string;
};

export function ComingSoon({ titleKey, descriptionKey }: ComingSoonProps) {
  const intl = useIntl();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: titleKey })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: descriptionKey })}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{intl.formatMessage({ id: "common.comingSoon" })}</p>
      </CardContent>
    </Card>
  );
}
