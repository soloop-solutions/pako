import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { getApiErrorMessage } from "@/api/client";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const errors: Record<string, string | null> = {};
    if (!email.trim()) {
      errors.email = intl.formatMessage({ id: "validation.required" });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = intl.formatMessage({ id: "validation.invalidEmail" });
    }
    if (!password) {
      errors.password = intl.formatMessage({ id: "validation.required" });
    } else if (!isLogin && password.length < 6) {
      errors.password = intl.formatMessage({ id: "validation.passwordTooShort" });
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
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
    <AuthLayout
      title={isLogin ? intl.formatMessage({ id: "auth.loginTitle" }) : intl.formatMessage({ id: "auth.registerTitle" })}
      description={intl.formatMessage({ id: "auth.platformDescription" })}
    >
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FormField label={intl.formatMessage({ id: "common.email" })} htmlFor="email" error={fieldErrors.email} required>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                aria-invalid={!!fieldErrors.email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, email: null }));
                }}
              />
            </FormField>
            <FormField label={intl.formatMessage({ id: "common.password" })} htmlFor="password" error={fieldErrors.password} required>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  value={password}
                  aria-invalid={!!fieldErrors.password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setFieldErrors((prev) => ({ ...prev, password: null }));
                  }}
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
            </FormField>
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
    </AuthLayout>
  );
}
