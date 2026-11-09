import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// docs/PLATFORM_ADMIN.md: there is no self-registration. People send their details here; the PAKO
// administrator approves the request (and how many companies they may create) and the person gets
// an email with a link to set their password.
export function RequestAccount() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", firmName: "", businessNumber: "", city: "", requestedCompanies: "1", message: "" });
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: null }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setApiError(null);

    const errors: Record<string, string | null> = {};
    if (!form.fullName.trim()) errors.fullName = t("validation.required");
    if (!form.email.trim()) errors.email = t("validation.required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = t("validation.invalidEmail");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSending(true);
    try {
      const blank = (v: string) => v.trim() || undefined;
      await apiClient.requestAccount({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: blank(form.phone),
        firmName: blank(form.firmName),
        businessNumber: blank(form.businessNumber),
        city: blank(form.city),
        requestedCompanies: Math.max(1, Math.min(100, Number(form.requestedCompanies) || 1)),
        message: blank(form.message),
      });
      setSent(true);
    } catch (err) {
      setApiError(getApiErrorMessage(err, t("requestAccount.error")));
    } finally {
      setSending(false);
    }
  }

  const field = (key: keyof typeof form, labelId: string, extra?: { type?: string; required?: boolean; autoComplete?: string }) => (
    <FormField label={t(labelId)} htmlFor={`ra-${key}`} error={fieldErrors[key]} required={extra?.required}>
      <Input
        id={`ra-${key}`}
        type={extra?.type}
        required={extra?.required}
        autoComplete={extra?.autoComplete}
        aria-invalid={!!fieldErrors[key]}
        value={form[key]}
        onChange={(e) => set(key)(e.target.value)}
      />
    </FormField>
  );

  return (
    <AuthLayout wide title={t("requestAccount.title")} description={t("requestAccount.description")}>
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="size-10 text-primary" aria-hidden />
              <p className="font-medium">{t("requestAccount.sentTitle")}</p>
              <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "requestAccount.sentBody" }, { email: form.email.trim() })}</p>
              <Link className="mt-2 text-sm underline" to="/login">
                {t("requestAccount.backToLogin")}
              </Link>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submit}>
              {apiError && (
                <Alert variant="destructive">
                  <AlertDescription>{apiError}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {field("fullName", "requestAccount.fullName", { required: true, autoComplete: "name" })}
                {field("email", "common.email", { required: true, type: "email", autoComplete: "email" })}
                {field("phone", "requestAccount.phone", { type: "tel", autoComplete: "tel" })}
                {field("city", "requestAccount.city")}
                {field("firmName", "requestAccount.firmName", { autoComplete: "organization" })}
                {field("businessNumber", "requestAccount.businessNumber")}
                <FormField label={t("requestAccount.requestedCompanies")} htmlFor="ra-requestedCompanies">
                  <Input
                    id="ra-requestedCompanies"
                    type="number"
                    min={1}
                    max={100}
                    value={form.requestedCompanies}
                    onChange={(e) => set("requestedCompanies")(e.target.value)}
                  />
                </FormField>
              </div>
              <FormField label={t("requestAccount.message")} htmlFor="ra-message">
                <Textarea id="ra-message" value={form.message} onChange={(e) => set("message")(e.target.value)} placeholder={t("requestAccount.messageHint")} />
              </FormField>
              <Button type="submit" disabled={sending}>
                {sending ? t("auth.pleaseWait") : t("requestAccount.send")}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {t("auth.hasAccount")}{" "}
                <Link className="underline" to="/login">
                  {t("auth.loginButton")}
                </Link>
              </p>
            </form>
          )}
    </AuthLayout>
  );
}
