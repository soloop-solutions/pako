import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";

type AuthFormProps = {
  mode: "login" | "register";
};

export function AuthForm({ mode }: AuthFormProps) {
  const intl = useIntl();
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password);
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          isLogin
            ? intl.formatMessage({ id: "auth.loginFallbackError" })
            : intl.formatMessage({ id: "auth.registerFallbackError" }),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {isLogin
              ? intl.formatMessage({ id: "auth.loginTitle" })
              : intl.formatMessage({ id: "auth.registerTitle" })}
          </CardTitle>
          <CardDescription>{intl.formatMessage({ id: "auth.platformDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{intl.formatMessage({ id: "common.email" })}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{intl.formatMessage({ id: "common.password" })}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {isLogin && (
              <Link className="-mt-2 self-end text-xs text-muted-foreground underline" to="/forgot-password">
                {intl.formatMessage({ id: "auth.forgotPassword" })}
              </Link>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting
                ? intl.formatMessage({ id: "auth.pleaseWait" })
                : isLogin
                  ? intl.formatMessage({ id: "auth.loginButton" })
                  : intl.formatMessage({ id: "auth.registerButton" })}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {isLogin ? (
              <>
                {intl.formatMessage({ id: "auth.noAccount" })}{" "}
                <Link className="underline" to="/request-account">
                  {intl.formatMessage({ id: "requestAccount.link" })}
                </Link>
              </>
            ) : (
              <>
                {intl.formatMessage({ id: "auth.hasAccount" })}{" "}
                <Link className="underline" to="/login">
                  {intl.formatMessage({ id: "auth.loginButton" })}
                </Link>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
