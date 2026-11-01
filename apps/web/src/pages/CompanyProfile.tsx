import { useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/context/CompanyContext";
import { emptyProfileValues, profileValuesFrom, toProfileRequest, type CompanyProfileValues } from "@/lib/company-profile";
import { CompanyProfileFields } from "@/pages/shared/CompanyProfileFields";

export function CompanyProfile() {
  const intl = useIntl();
  const { activeCompany, refresh } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [values, setValues] = useState<CompanyProfileValues>(emptyProfileValues);
  const [vatRegistered, setVatRegistered] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Reset form when active company changes
  // Reset only when another company is opened — not on every refresh of the company list, which
  // would wipe what the user is typing.
  const companyKey = activeCompany?.id;
  useEffect(() => {
    if (!activeCompany) return;
    setValues(profileValuesFrom(activeCompany));
    setVatRegistered(activeCompany.isVatRegistered);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey]);

  function change(patch: Partial<CompanyProfileValues>) {
    setValues((v) => ({ ...v, ...patch }));
    setDirty(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.profile(companyId, toProfileRequest(values, vatRegistered));
      await refresh();
      setDirty(false);
      toast.success(intl.formatMessage({ id: "companyProfile.saved" }));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "companyProfile.saveError" })));
    } finally {
      setSaving(false);
    }
  }

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        {intl.formatMessage({ id: "common.selectCompanyFirst" })}
      </p>
    );
  }

  const isArchived = activeCompany.isArchived;

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSave}>
      {isArchived && (
        <Alert>
          <AlertDescription>{intl.formatMessage({ id: "companyProfile.archivedBanner" })}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <CompanyProfileFields
        values={values}
        onChange={change}
        vatRegistered={vatRegistered}
        onVatRegisteredChange={(v) => {
          setVatRegistered(v);
          setDirty(true);
        }}
        currency={activeCompany.functionalCurrency}
        companyId={activeCompany.id}
        logoUrl={activeCompany.logoUrl}
        stampUrl={activeCompany.stampUrl}
        onBrandingChange={() => {
          void refresh();
          setDirty(false);
        }}
      />

      {/* Sticky save bar */}
      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button type="submit" disabled={saving || !dirty || isArchived}>
          {saving
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: "common.save" })}
        </Button>
        {dirty && (
          <span className="text-xs text-muted-foreground">
            {intl.formatMessage({ id: "companyProfile.unsavedChanges" })}
          </span>
        )}
      </div>
    </form>
  );
}
