import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link, useSearchParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

function Shell({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <AuthLayout title={title} description={description}>
      {children}
    </AuthLayout>
  );
}

// The answer is the same whether or not the address has an account.
export function ForgotPassword() {
  const intl = useIntl();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  function validateEmail(value: string): string | null {
    if (!value.trim()) return intl.formatMessage({ id: "validation.required" });
    if (!EMAIL_RE.test(value.trim())) return intl.formatMessage({ id: "validation.invalidEmail" });
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const err = validateEmail(email);
    if (err) {
      setEmailError(err);
      return;
    }
    try {
      await apiClient.forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "auth.resetError" })));
    }
  }

  return (
    <Shell title={intl.formatMessage({ id: "auth.forgotTitle" })} description={intl.formatMessage({ id: "auth.forgotDescription" })}>
      {sent ? (
        <Alert>
          <AlertDescription>{intl.formatMessage({ id: "auth.forgotSent" }, { email })}</AlertDescription>
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FormField
            label={intl.formatMessage({ id: "common.email" })}
            htmlFor="forgot-email"
            error={emailError}
          >
            <Input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "forgot-email-error" : undefined}
              onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
            />
          </FormField>
          <Button type="submit">{intl.formatMessage({ id: "auth.sendResetLink" })}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link className="underline" to="/login">
          {intl.formatMessage({ id: "auth.backToLogin" })}
        </Link>
      </p>
    </Shell>
  );
}

export function ResetPassword() {
  const intl = useIntl();
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  function validatePassword(value: string): string | null {
    if (!value) return intl.formatMessage({ id: "validation.required" });
    if (value.length < MIN_PASSWORD_LENGTH) return intl.formatMessage({ id: "validation.passwordTooShort" });
    return null;
  }

  function validateConfirm(pw: string, cf: string): string | null {
    if (!cf) return intl.formatMessage({ id: "validation.required" });
    if (pw !== cf) return intl.formatMessage({ id: "validation.passwordMismatch" });
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pwErr = validatePassword(password);
    const cfErr = validateConfirm(password, confirm);
    setPasswordError(pwErr);
    setConfirmError(cfErr);
    if (pwErr || cfErr) return;
    try {
      await apiClient.resetPassword({ email, token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "auth.resetError" })));
    }
  }

  return (
    <Shell title={intl.formatMessage({ id: "auth.resetTitle" })} description={email}>
      {done ? (
        <Alert>
          <AlertDescription>
            {intl.formatMessage({ id: "auth.resetDone" })}{" "}
            <Link className="underline" to="/login">
              {intl.formatMessage({ id: "auth.loginButton" })}
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FormField
            label={intl.formatMessage({ id: "auth.newPassword" })}
            htmlFor="reset-password"
            error={passwordError}
          >
            <Input
              id="reset-password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? "reset-password-error" : undefined}
              onChange={(e) => { setPassword(e.target.value); setPasswordError(null); }}
            />
          </FormField>
          <FormField
            label={intl.formatMessage({ id: "auth.confirmPassword" })}
            htmlFor="reset-confirm"
            error={confirmError}
            hint={intl.formatMessage({ id: "auth.passwordRules" })}
          >
            <Input
              id="reset-confirm"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              aria-invalid={!!confirmError}
              aria-describedby={confirmError ? "reset-confirm-error" : undefined}
              onChange={(e) => { setConfirm(e.target.value); setConfirmError(null); }}
            />
          </FormField>
          <Button type="submit" disabled={!token || !email}>
            {intl.formatMessage({ id: "auth.setPassword" })}
          </Button>
        </form>
      )}
    </Shell>
  );
}
