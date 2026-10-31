import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link, useSearchParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Shell({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

// The answer is the same whether or not the address has an account.
export function ForgotPassword() {
  const intl = useIntl();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="forgot-email">{intl.formatMessage({ id: "common.email" })}</Label>
            <Input id="forgot-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(intl.formatMessage({ id: "auth.passwordsDiffer" }));
      return;
    }
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-password">{intl.formatMessage({ id: "auth.newPassword" })}</Label>
            <Input id="reset-password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-confirm">{intl.formatMessage({ id: "auth.confirmPassword" })}</Label>
            <Input id="reset-confirm" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "auth.passwordRules" })}</span>
          </div>
          <Button type="submit" disabled={!token || !email}>
            {intl.formatMessage({ id: "auth.setPassword" })}
          </Button>
        </form>
      )}
    </Shell>
  );
}
