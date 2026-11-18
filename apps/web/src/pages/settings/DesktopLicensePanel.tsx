import { useIntl } from "react-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/pages/desktop/CopyButton";
import { daysUntil, useDesktopLicense } from "@/pages/desktop/useDesktopLicense";

export function DesktopLicensePanel() {
  const intl = useIntl();
  const { data } = useDesktopLicense();
  if (!data || data.status !== "Licensed") return null;
  const expires =
    daysUntil(data.expiresAt) === null
      ? intl.formatMessage({ id: "desktop.license.noExpiry" })
      : intl.formatDate(data.expiresAt!, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "desktop.license.panelTitle" })}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{intl.formatMessage({ id: "desktop.license.customer" })}</dt>
          <dd>{data.customer ?? "—"}</dd>
          <dt className="text-muted-foreground">{intl.formatMessage({ id: "desktop.license.expires" })}</dt>
          <dd>{expires}</dd>
          <dt className="text-muted-foreground">{intl.formatMessage({ id: "desktop.license.machineCode" })}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs select-all">{data.machineCode}</code>
            <CopyButton value={data.machineCode} />
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
