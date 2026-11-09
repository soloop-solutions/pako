import { useRef, useState, type FormEvent } from "react";
import { ApiException } from "@pako/shared";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

interface ActionPasswordDialogProps {
  companyName: string;
  companyId: string;
  action: string;
  actionLabelId: string;
  onConfirm: (token: string) => void;
  onCancel: () => void;
}

export function ActionPasswordDialog({
  companyName,
  companyId,
  action,
  actionLabelId,
  onConfirm,
  onCancel,
}: ActionPasswordDialogProps) {
  const intl = useIntl();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (verifying) return;
    if (!password.trim()) {
      setFieldError(intl.formatMessage({ id: "actionPassword.passwordRequired" }));
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setFieldError(null);
    setVerifying(true);
    try {
      const response = await apiClient.actionTokens({ password, action, companyId });
      onConfirm(response.token);
    } catch (err) {
      if (err instanceof ApiException && err.status === 429) {
        setError(intl.formatMessage({ id: "actionPassword.tooManyAttempts" }));
      } else if (err instanceof ApiException && err.status === 401) {
        setError(intl.formatMessage({ id: "actionPassword.wrongPassword" }));
      } else {
        setError(intl.formatMessage({ id: "actionPassword.error" }));
      }
      setPassword("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <div
        className="mx-4 w-full max-w-md rounded-lg border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-password-dialog-title"
      >
        <div className="mb-5 flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <h2 id="action-password-dialog-title" className="text-lg font-semibold">
            {intl.formatMessage({ id: "actionPassword.title" })}
          </h2>
        </div>

        <div className="mb-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: "actionPassword.actionLabel" })}
          </p>
          <div className="rounded-md border bg-muted/50 px-3 py-2">
            <span className="text-sm font-medium">
              {intl.formatMessage({ id: actionLabelId })}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">({companyName})</span>
          </div>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          {intl.formatMessage({ id: "actionPassword.prompt" })}
        </p>

        <form onSubmit={handleSubmit}>
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <FormField
            label={intl.formatMessage({ id: "actionPassword.passwordLabel" })}
            htmlFor="action-password"
            error={fieldError}
            required
            className="mb-4"
          >
            <div className="relative">
              <Input
                ref={inputRef}
                id="action-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                className="pr-10"
                disabled={verifying}
                aria-invalid={!!fieldError}
                aria-describedby={fieldError ? "action-password-error" : undefined}
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

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={verifying}>
              {intl.formatMessage({ id: "actionPassword.cancel" })}
            </Button>
            <Button type="submit" disabled={verifying || !password.trim()}>
              {verifying ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {intl.formatMessage({ id: "actionPassword.verifying" })}
                </>
              ) : (
                intl.formatMessage({ id: "actionPassword.confirm" })
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
