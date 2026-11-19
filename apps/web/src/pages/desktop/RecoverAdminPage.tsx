import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { getDesktopBridge } from "@/lib/desktopBridge";
import { RecoveryCodeDisplay } from "@/pages/desktop/RecoveryCodeDisplay";

export function RecoverAdminPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  if (!getDesktopBridge()) return <Navigate to="/login" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await apiClient.recoverDesktopAdmin({ email: email.trim(), recoveryCode: code.trim(), newPassword: password });
      setNewCode(response.recoveryCode);
    } catch {
      setError(intl.formatMessage({ id: "desktop.recover.error" }));
    } finally {
      setSubmitting(false);
    }
  }

  if (newCode) {
    return (
      <AuthLayout
        title={intl.formatMessage({ id: "desktop.recover.newCodeTitle" })}
        description={intl.formatMessage({ id: "desktop.recover.newCodeWarning" })}
      >
        <RecoveryCodeDisplay
          code={newCode}
          onContinue={() => navigate("/login", { replace: true, state: { notice: "desktop.recover.success" } })}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={intl.formatMessage({ id: "desktop.recover.title" })}
      description={intl.formatMessage({ id: "desktop.recover.description" })}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <FormField label={intl.formatMessage({ id: "common.email" })} htmlFor="rc-email" required>
          <Input id="rc-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label={intl.formatMessage({ id: "desktop.recover.code" })} htmlFor="rc-code" required>
          <Input id="rc-code" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} />
        </FormField>
        <FormField label={intl.formatMessage({ id: "desktop.recover.newPassword" })} htmlFor="rc-password" required>
          <Input id="rc-password" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <Button type="submit" disabled={submitting}>
          {submitting ? intl.formatMessage({ id: "auth.pleaseWait" }) : intl.formatMessage({ id: "desktop.recover.submit" })}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link className="underline" to="/login">
          {intl.formatMessage({ id: "desktop.recover.back" })}
        </Link>
      </p>
    </AuthLayout>
  );
}
