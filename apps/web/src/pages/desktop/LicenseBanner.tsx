import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/pages/desktop/CopyButton";
import { daysUntil, EXPIRY_WARNING_DAYS, LICENSE_KEY, useDesktopLicense } from "@/pages/desktop/useDesktopLicense";

export function LicenseBanner() {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { data } = useDesktopLicense();
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!data) return null;
  const readOnly = data.status === "ReadOnly";
  const licensed = data.status === "Licensed";
  const expiryDays = licensed ? daysUntil(data.expiresAt) : null;
  if (licensed && (expiryDays === null || expiryDays > EXPIRY_WARNING_DAYS)) return null;

  async function activate(event: FormEvent) {
    event.preventDefault();
    if (!licenseKey.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const next = await apiClient.activateDesktopLicense({ licenseKey: licenseKey.trim() });
      setLicenseKey("");
      queryClient.setQueryData(LICENSE_KEY, next);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="shrink-0 border-b border-warning-border bg-warning px-4 py-2 text-sm text-warning-foreground lg:px-6" data-testid="license-banner">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="font-medium">
          {licensed
            ? intl.formatMessage(
                { id: "desktop.license.expiresSoon" },
                { date: intl.formatDate(data.expiresAt!, { dateStyle: "medium", timeZone: "UTC" }), days: Math.max(0, expiryDays!) },
              )
            : readOnly
              ? intl.formatMessage({ id: "desktop.license.readOnly" })
              : intl.formatMessage({ id: data.trialDaysLeft === 1 ? "desktop.license.trialOne" : "desktop.license.trial" }, { days: data.trialDaysLeft })}
        </p>
        <div className="flex items-center gap-2">
          <span>{intl.formatMessage({ id: "desktop.license.machineCode" })}:</span>
          <code className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-xs select-all">{data.machineCode}</code>
          <CopyButton value={data.machineCode} />
        </div>
        <form className="ml-auto flex items-center gap-2" onSubmit={activate}>
          <Label htmlFor="license-key" className="sr-only">
            {intl.formatMessage({ id: "desktop.license.keyLabel" })}
          </Label>
          <Input
            id="license-key"
            className="w-64 bg-background"
            autoComplete="off"
            placeholder={intl.formatMessage({ id: "desktop.license.keyPlaceholder" })}
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={submitting || !licenseKey.trim()}>
            {submitting ? intl.formatMessage({ id: "desktop.license.activating" }) : intl.formatMessage({ id: "desktop.license.activate" })}
          </Button>
        </form>
      </div>
      {error && <p role="alert" className="mt-1 font-medium text-destructive">{error}</p>}
    </div>
  );
}
