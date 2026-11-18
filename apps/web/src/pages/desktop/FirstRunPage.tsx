import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { Navigate, useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RecoveryCodeDisplay } from "@/pages/desktop/RecoveryCodeDisplay";
import { DESKTOP_SETUP_KEY, useDesktopSetup } from "@/pages/desktop/useDesktopSetup";

export function FirstRunPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { loading, needsSetup } = useDesktopSetup();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const next: Record<string, string | null> = {};
    if (!email.trim()) next.email = intl.formatMessage({ id: "validation.required" });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = intl.formatMessage({ id: "validation.invalidEmail" });
    if (!fullName.trim()) next.fullName = intl.formatMessage({ id: "validation.required" });
    if (!password) next.password = intl.formatMessage({ id: "validation.required" });
    else if (password.length < 6) next.password = intl.formatMessage({ id: "validation.passwordTooShort" });
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    try {
      const response = await apiClient.completeDesktopSetup({ email: email.trim(), fullName: fullName.trim(), password });
      setRecoveryCode(response.recoveryCode);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "desktop.firstRun.error" })));
    } finally {
      setSubmitting(false);
    }
  }

  function handleContinue() {
    queryClient.setQueryData(DESKTOP_SETUP_KEY, { needsSetup: false, available: true });
    navigate("/login", { replace: true });
  }

  if (recoveryCode) {
    return (
      <AuthLayout
        title={intl.formatMessage({ id: "desktop.firstRun.codeTitle" })}
        description={intl.formatMessage({ id: "desktop.firstRun.codeWarning" })}
      >
        <RecoveryCodeDisplay code={recoveryCode} onContinue={handleContinue} />
      </AuthLayout>
    );
  }

  if (loading) return <div className="flex-1" />;
  if (!needsSetup) return <Navigate to="/login" replace />;

  return (
    <AuthLayout
      title={intl.formatMessage({ id: "desktop.firstRun.title" })}
      description={intl.formatMessage({ id: "desktop.firstRun.description" })}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <FormField label={intl.formatMessage({ id: "common.email" })} htmlFor="fr-email" error={errors.email} required>
          <Input id="fr-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label={intl.formatMessage({ id: "desktop.firstRun.fullName" })} htmlFor="fr-name" error={errors.fullName} required>
          <Input id="fr-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </FormField>
        <FormField label={intl.formatMessage({ id: "common.password" })} htmlFor="fr-password" error={errors.password} required>
          <Input id="fr-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <Button type="submit" disabled={submitting}>
          {submitting ? intl.formatMessage({ id: "auth.pleaseWait" }) : intl.formatMessage({ id: "desktop.firstRun.create" })}
        </Button>
      </form>
    </AuthLayout>
  );
}
