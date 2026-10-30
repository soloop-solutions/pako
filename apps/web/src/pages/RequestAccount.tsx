import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// docs/PLATFORM_ADMIN.md: there is no self-registration. People send their details here; the PAKO
// administrator approves the request (and how many companies they may create) and the person gets
// an email with a link to set their password.
export function RequestAccount() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", firmName: "", businessNumber: "", city: "", requestedCompanies: "1", message: "" });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
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
      setError(getApiErrorMessage(err, t("requestAccount.error")));
    } finally {
      setSending(false);
    }
  }

  const field = (key: keyof typeof form, labelId: string, extra?: { type?: string; required?: boolean; autoComplete?: string }) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`ra-${key}`}>
        {t(labelId)}
        {extra?.required ? " *" : ""}
      </Label>
      <Input
        id={`ra-${key}`}
        type={extra?.type}
        required={extra?.required}
        autoComplete={extra?.autoComplete}
        value={form[key]}
        onChange={(e) => set(key)(e.target.value)}
      />
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("requestAccount.title")}</CardTitle>
          <CardDescription>{t("requestAccount.description")}</CardDescription>
        </CardHeader>
        <CardContent>
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
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {field("fullName", "requestAccount.fullName", { required: true, autoComplete: "name" })}
                {field("email", "common.email", { required: true, type: "email", autoComplete: "email" })}
                {field("phone", "requestAccount.phone", { type: "tel", autoComplete: "tel" })}
                {field("city", "requestAccount.city")}
                {field("firmName", "requestAccount.firmName", { autoComplete: "organization" })}
                {field("businessNumber", "requestAccount.businessNumber")}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ra-requestedCompanies">{t("requestAccount.requestedCompanies")}</Label>
                  <Input
                    id="ra-requestedCompanies"
                    type="number"
                    min={1}
                    max={100}
                    value={form.requestedCompanies}
                    onChange={(e) => set("requestedCompanies")(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ra-message">{t("requestAccount.message")}</Label>
                <Textarea id="ra-message" value={form.message} onChange={(e) => set("message")(e.target.value)} placeholder={t("requestAccount.messageHint")} />
              </div>
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
        </CardContent>
      </Card>
    </div>
  );
}
