import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { parseAccessLink } from "@/lib/accessLink";
import { getDesktopBridge } from "@/lib/desktopBridge";

export function AccessLinkPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!getDesktopBridge()) return <Navigate to="/login" replace />;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const path = parseAccessLink(value);
    if (!path) {
      setError(intl.formatMessage({ id: "desktop.accessLink.invalid" }));
      return;
    }
    navigate(path);
  }

  return (
    <AuthLayout
      title={intl.formatMessage({ id: "desktop.accessLink.title" })}
      description={intl.formatMessage({ id: "desktop.accessLink.description" })}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <FormField label={intl.formatMessage({ id: "desktop.accessLink.label" })} htmlFor="al-link" required>
          <Input
            id="al-link"
            autoComplete="off"
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
        </FormField>
        <Button type="submit">{intl.formatMessage({ id: "desktop.accessLink.submit" })}</Button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link className="underline" to="/login">
          {intl.formatMessage({ id: "desktop.recover.back" })}
        </Link>
      </p>
    </AuthLayout>
  );
}
