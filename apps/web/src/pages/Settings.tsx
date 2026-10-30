import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { LockDatesSettings } from "@/pages/settings/LockDatesSettings";
import { NotificationSettings } from "@/pages/settings/NotificationSettings";
import { NumberingSettings } from "@/pages/settings/NumberingSettings";
import { StatutoryParametersSettings } from "@/pages/settings/StatutoryParametersSettings";

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
            // docs/USER_ACCESS_PLAN.md: users and roles moved to the administration dashboard.
            <p className="text-sm">
              {intl.formatMessage(
                { id: "settings.accessMoved" },
                {
                  link: (chunks) => (
                    <Link className="text-primary underline" to="/admin/users">
                      {chunks}
                    </Link>
                  ),
                },
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
          )}
        </CardContent>
      </Card>

      {activeCompany && <NumberingSettings companyId={activeCompany.id} />}

      {activeCompany && <LockDatesSettings companyId={activeCompany.id} />}

      {activeCompany && <NotificationSettings companyId={activeCompany.id} />}

      {activeCompany?.firmId && <StatutoryParametersSettings firmId={activeCompany.firmId} />}
    </div>
  );
}
