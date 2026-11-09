import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { Lock } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { BusinessTypeSettings } from "@/pages/settings/BusinessTypeSettings";
import { LockDatesSettings } from "@/pages/settings/LockDatesSettings";
import { NotificationSettings } from "@/pages/settings/NotificationSettings";
import { NumberingSettings } from "@/pages/settings/NumberingSettings";
import { StatutoryParametersSettings } from "@/pages/settings/StatutoryParametersSettings";

export function Settings() {
  const intl = useIntl();
  const { auth } = useAuth();
  const { activeCompany } = useCompany();
  const { canSee } = useMyAccess();

  // Account card (email) is always visible; company settings require Settings access.
  const hasSettingsAccess = canSee("settings");

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "settings.accountTitle" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "settings.accountDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-sm flex-col gap-1.5">
            <Label>{intl.formatMessage({ id: "common.email" })}</Label>
            <div className="flex h-7 items-center gap-2 rounded-md border border-input bg-muted px-2.5 text-[12.5px] text-muted-foreground">
              <Lock className="size-3 shrink-0" />
              <span className="truncate">{auth?.email ?? ""}</span>
            </div>
            <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "settings.emailReadOnly" })}</span>
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

      {/* Business types: the company's type and the packs it uses. */}
      {activeCompany && hasSettingsAccess && <BusinessTypeSettings companyId={activeCompany.id} />}

      {activeCompany && hasSettingsAccess && <NumberingSettings companyId={activeCompany.id} />}

      {activeCompany && hasSettingsAccess && <LockDatesSettings companyId={activeCompany.id} />}

      {activeCompany && hasSettingsAccess && <NotificationSettings companyId={activeCompany.id} />}

      {activeCompany?.firmId && hasSettingsAccess && <StatutoryParametersSettings firmId={activeCompany.firmId} />}
    </div>
  );
}
