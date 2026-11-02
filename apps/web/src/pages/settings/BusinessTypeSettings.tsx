import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCompany } from "@/context/CompanyContext";
import { useFeatures } from "@/hooks/useFeatures";
import { useMyAccess } from "@/hooks/useMyAccess";
import { BusinessType, businessTypeLabel, packList, presetPacks, sortPacks } from "@/lib/business-types";
import { BusinessTypePicker } from "@/pages/shared/BusinessTypePicker";

/**
 * Settings → Business type: what kind of business the company is and the packs it uses. A company
 * administrator can change the type; the server then resets the packs to the new type's preset.
 */
export function BusinessTypeSettings({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const queryClient = useQueryClient();
  const { companies, refresh } = useCompany();
  const { access } = useMyAccess();
  const features = useFeatures();
  const company = companies.find((c) => c.id === companyId) ?? null;

  const currentType = features.businessType ?? company?.businessType ?? BusinessType.General;
  const currentPacks = sortPacks(features.features ?? company?.features ?? []);
  const isAdmin = access?.isAdmin ?? false;

  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<number>(currentType);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => apiClient.updateCompanyBusinessType(companyId, { businessType: chosen }),
    onSuccess: async () => {
      setConfirming(false);
      setEditing(false);
      setError(null);
      toast.success(t("company.businessTypeSettings.saved"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["myAccess"] }),
        queryClient.invalidateQueries({ queryKey: ["company"] }),
        queryClient.invalidateQueries({ queryKey: ["companies"] }),
        refresh(),
      ]);
    },
    onError: (err: unknown) => {
      setConfirming(false);
      setError(getApiErrorMessage(err, t("company.businessTypeSettings.saveError")));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("company.businessTypeSettings.title")}</CardTitle>
        <CardDescription>{t("company.businessTypeSettings.description", { companyName: company?.name ?? "" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("company.businessType")}</dt>
          <dd className="font-medium" data-testid="business-type-current">{businessTypeLabel(intl, currentType)}</dd>
          <dt className="text-muted-foreground">{t("company.packs")}</dt>
          <dd className="flex flex-wrap gap-1" data-testid="business-type-packs">
            {currentPacks.length === 0 ? (
              <span className="text-muted-foreground">{t("company.packs.none")}</span>
            ) : (
              currentPacks.map((p) => (
                <Badge key={p} variant="secondary">
                  {t(`company.pack.${p}`)}
                </Badge>
              ))
            )}
          </dd>
        </dl>

        {!isAdmin ? (
          <p className="text-xs text-muted-foreground">{t("company.businessTypeSettings.adminOnly")}</p>
        ) : !editing ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setChosen(currentType);
                setEditing(true);
              }}
            >
              {t("company.businessTypeSettings.change")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <BusinessTypePicker name="settings-business-type" value={chosen} onChange={setChosen} disabled={save.isPending} />
            <p className="text-xs text-muted-foreground">
              {t("company.businessType.switchesOn", { packs: packList(intl, presetPacks(chosen)) })}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={chosen === currentType || save.isPending} onClick={() => setConfirming(true)}>
                {t("common.save")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={confirming} onOpenChange={(open) => !open && !save.isPending && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("company.businessTypeSettings.confirmTitle", { type: businessTypeLabel(intl, chosen) })}</DialogTitle>
            <DialogDescription>
              {t("company.businessTypeSettings.confirmBody", { packs: packList(intl, presetPacks(chosen)) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {t("company.businessTypeSettings.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
