import { useIntl } from "react-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { MembersPanel } from "@/pages/shared/MembersPanel";

export function Settings() {
  const intl = useIntl();
  const { auth } = useAuth();
  const { activeCompany } = useCompany();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "settings.accountTitle" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "settings.accountDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="settings-email">{intl.formatMessage({ id: "common.email" })}</Label>
            <Input id="settings-email" value={auth?.email ?? ""} readOnly />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "settings.accessTitle" })}</CardTitle>
          <CardDescription>
            {activeCompany
              ? intl.formatMessage({ id: "settings.accessDescriptionWithCompany" }, { companyName: activeCompany.name })
              : intl.formatMessage({ id: "settings.accessDescriptionNoCompany" })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeCompany ? (
            <MembersPanel scope="company" scopeId={activeCompany.id} />
          ) : (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
