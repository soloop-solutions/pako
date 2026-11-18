import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/hooks/useAccount";
import { getDesktopBridge } from "@/lib/desktopBridge";
import { RecoveryCodeDisplay } from "@/pages/desktop/RecoveryCodeDisplay";

function Panel() {
  const intl = useIntl();
  const account = useAccount();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  if (account.data?.isPlatformAdmin !== true) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await apiClient.regenerateDesktopRecoveryCode({ currentPassword: password });
      setCode(response.recoveryCode);
      setAsking(false);
      setPassword("");
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "desktop.recoveryCode.error" })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "desktop.recoveryCode.title" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "desktop.recoveryCode.description" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex max-w-md flex-col gap-4">
        {code ? (
          <>
            <p className="text-sm">{intl.formatMessage({ id: "desktop.recoveryCode.shownOnce" })}</p>
            <RecoveryCodeDisplay code={code} onContinue={() => setCode(null)} />
          </>
        ) : asking ? (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FormField label={intl.formatMessage({ id: "desktop.recoveryCode.currentPassword" })} htmlFor="rcg-password" required>
              <Input
                id="rcg-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting || !password}>
                {submitting ? intl.formatMessage({ id: "auth.pleaseWait" }) : intl.formatMessage({ id: "desktop.recoveryCode.submit" })}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAsking(false);
                  setPassword("");
                  setError(null);
                }}
              >
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" variant="outline" onClick={() => setAsking(true)}>
              {intl.formatMessage({ id: "desktop.recoveryCode.generate" })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DesktopRecoveryCodePanel() {
  if (!getDesktopBridge()) return null;
  return <Panel />;
}
