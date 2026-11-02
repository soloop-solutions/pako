import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFeatures } from "@/hooks/useFeatures";
import type { Pack } from "@/lib/business-types";

/**
 * Business types: a page of a vertical pack, opened directly (a bookmark, an old tab) while the pack
 * is off for the active company, explains itself instead of failing with 403s. Display only — the
 * server refuses the pack's endpoints regardless. Renders nothing while the answer loads.
 */
export function FeatureGate({ feature, children, fullScreen = false }: { feature?: Pack | readonly Pack[]; children: ReactNode; fullScreen?: boolean }) {
  const { hasFeature, isLoading } = useFeatures();
  if (!feature || hasFeature(feature)) return <>{children}</>;
  if (isLoading) return null;
  return fullScreen ? (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <FeatureOff />
    </div>
  ) : (
    <FeatureOff />
  );
}

export function FeatureOff() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <Card className="max-w-xl" data-testid="feature-off">
      <CardHeader>
        <CardTitle>{t("company.featureOff.title")}</CardTitle>
        <CardDescription>{t("company.featureOff.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link className="text-sm text-primary underline" to="/dashboard">
          {t("company.featureOff.back")}
        </Link>
      </CardContent>
    </Card>
  );
}
