import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { NavModule } from "@/config/nav";
import { useMyAccess } from "@/hooks/useMyAccess";

export function ModuleGate({ module, children }: { module?: NavModule; children: ReactNode }) {
  const intl = useIntl();
  const { canSee, isLoading } = useMyAccess();
  if (!module || canSee(module)) return <>{children}</>;
  if (isLoading) return null;
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <Card className="max-w-xl" data-testid="module-off">
      <CardHeader>
        <CardTitle>{t("company.moduleOff.title")}</CardTitle>
        <CardDescription>{t("company.moduleOff.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link className="text-sm text-primary underline" to="/dashboard">
          {t("company.featureOff.back")}
        </Link>
      </CardContent>
    </Card>
  );
}
