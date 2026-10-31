import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";

// docs/USER_ACCESS_PLAN.md: the link an admin's invitation carries. A new person sets a password;
// someone who already has a PAKO login confirms it with that login's password.
export function AcceptInvitation() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { acceptInvitation } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const infoQuery = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => apiClient.getInvitation(token),
    enabled: !!token,
    retry: false,
  });
  const info = infoQuery.data;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!info?.accountExists && password !== confirm) {
      setError(intl.formatMessage({ id: "auth.passwordsDiffer" }));
      return;
    }
    setSubmitting(true);
    try {
      await acceptInvitation(token, fullName.trim() || undefined, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "auth.acceptError" })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "auth.acceptTitle" })}</CardTitle>
          {info && <CardDescription>{intl.formatMessage({ id: "auth.acceptDescription" }, { company: info.companyName, email: info.email })}</CardDescription>}
        </CardHeader>
        <CardContent>
          {(!token || infoQuery.isError) && (
            <Alert variant="destructive">
              <AlertDescription>
                {infoQuery.isError ? getApiErrorMessage(infoQuery.error, intl.formatMessage({ id: "auth.inviteInvalid" })) : intl.formatMessage({ id: "auth.inviteInvalid" })}
              </AlertDescription>
            </Alert>
          )}
          {infoQuery.isPending && token && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>}
          {info && (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {info.accountExists ? (
                <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "auth.acceptExisting" }, { company: info.companyName })}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="accept-name">{intl.formatMessage({ id: "admin.users.fullName" })}</Label>
                  <Input id="accept-name" autoComplete="name" value={fullName || info.fullName || ""} onChange={(e) => setFullName(e.target.value)} />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="accept-password">{intl.formatMessage({ id: info.accountExists ? "common.password" : "auth.newPassword" })}</Label>
                <Input
                  id="accept-password"
                  type="password"
                  required
                  autoComplete={info.accountExists ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {!info.accountExists && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="accept-confirm">{intl.formatMessage({ id: "auth.confirmPassword" })}</Label>
                  <Input id="accept-confirm" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                  <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "auth.passwordRules" })}</span>
                </div>
              )}
              <Button type="submit" disabled={submitting}>
                {intl.formatMessage({ id: submitting ? "auth.pleaseWait" : "auth.acceptButton" })}
              </Button>
              {info.accountExists && (
                <Link className="text-center text-sm underline" to="/forgot-password">
                  {intl.formatMessage({ id: "auth.forgotPassword" })}
                </Link>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
