import type { ReactNode } from "react";
import { useIntl } from "react-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LEGAL_FORM_OPTIONS, type CompanyProfileValues } from "@/lib/company-profile";

// Every company detail, in the five sections of Settings → Company profile. Used there (as cards)
// and in the lobby's "New company" dialog (as plain sections), so both ask for the same fields.
export function CompanyProfileFields({
  values,
  onChange,
  idPrefix = "cp",
  variant = "cards",
  vatRegistered,
  onVatRegisteredChange,
  currency,
}: {
  values: CompanyProfileValues;
  onChange: (patch: Partial<CompanyProfileValues>) => void;
  idPrefix?: string;
  variant?: "cards" | "plain";
  vatRegistered: boolean;
  /** When given, VAT registration is chosen here (new company); otherwise it is read-only. */
  onVatRegisteredChange?: (value: boolean) => void;
  currency: string;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const id = (name: string) => `${idPrefix}-${name}`;

  const text = (name: keyof CompanyProfileValues, labelId: string, extra?: { type?: string; placeholder?: string; required?: boolean; className?: string }) => (
    <div className={cn("flex flex-col gap-1", extra?.className)}>
      <Label htmlFor={id(name)}>
        {t(labelId)}
        {extra?.required ? " *" : ""}
      </Label>
      <Input
        id={id(name)}
        type={extra?.type}
        required={extra?.required}
        placeholder={extra?.placeholder}
        value={values[name] as string}
        onChange={(e) => onChange({ [name]: e.target.value })}
      />
    </div>
  );

  const area = (name: keyof CompanyProfileValues, labelId: string, placeholderId?: string, className?: string) => (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={id(name)}>{t(labelId)}</Label>
      <Textarea
        id={id(name)}
        value={values[name] as string}
        onChange={(e) => onChange({ [name]: e.target.value })}
        placeholder={placeholderId ? t(placeholderId) : undefined}
      />
    </div>
  );

  // A plain function, not a component: a component defined here would remount its inputs on
  // every keystroke and lose focus.
  const section = (titleId: string, descriptionId: string, children: ReactNode) =>
    variant === "cards" ? (
      <Card>
        <CardHeader>
          <CardTitle>{t(titleId)}</CardTitle>
          <CardDescription>{t(descriptionId)}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    ) : (
      <section className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
        <div>
          <h3 className="text-sm font-semibold">{t(titleId)}</h3>
          <p className="text-xs text-muted-foreground">{t(descriptionId)}</p>
        </div>
        {children}
      </section>
    );

  const vatLabel = t(vatRegistered ? "companyProfile.vatRegistered.yes" : "companyProfile.vatRegistered.no");

  return (
    <>
      {section("companyProfile.general", "companyProfile.general.description", (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text("name", "companyProfile.name", { required: true })}
          {text("tradingName", "companyProfile.tradingName", { placeholder: t("companyProfile.tradingName.hint") })}
          <div className="flex flex-col gap-1">
            <Label htmlFor={id("legalForm")}>{t("companyProfile.legalForm")}</Label>
            <Select
              id={id("legalForm")}
              value={String(values.legalForm ?? "")}
              onValueChange={(v) => onChange({ legalForm: v ? Number(v) : null })}
              placeholder={t("companyProfile.legalForm.placeholder")}
              options={LEGAL_FORM_OPTIONS.map((o) => ({ value: String(o.value), label: t(o.labelKey) }))}
            />
          </div>
          {text("businessActivity", "companyProfile.businessActivity")}
          {area("description", "companyProfile.description", undefined, "sm:col-span-2")}
        </div>
      ))}

      {section("companyProfile.legalFiscal", "companyProfile.legalFiscal.description", (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {text("businessNumber", "companyProfile.businessNumber")}
          {text("fiscalNumber", "companyProfile.fiscalNumber")}
          {text("vatNumber", "companyProfile.vatNumber")}
          <div className="flex flex-col gap-1">
            <Label htmlFor={id("vatRegistered")}>{t("companyProfile.vatRegistered")}</Label>
            {onVatRegisteredChange ? (
              <Select
                id={id("vatRegistered")}
                value={vatRegistered ? "yes" : "no"}
                onValueChange={(v) => onVatRegisteredChange(v === "yes")}
                options={[
                  { value: "yes", label: t("companyProfile.vatRegistered.yes") },
                  { value: "no", label: t("companyProfile.vatRegistered.no") },
                ]}
              />
            ) : (
              <Input id={id("vatRegistered")} readOnly disabled value={vatLabel} />
            )}
          </div>
          {text("vatRegistrationDate", "companyProfile.vatRegistrationDate", { type: "date" })}
          <div className="flex flex-col gap-1">
            <Label htmlFor={id("currency")}>{t("companyProfile.currency")}</Label>
            <Input id={id("currency")} readOnly disabled value={currency} />
          </div>
        </div>
      ))}

      {section("companyProfile.addressContact", "companyProfile.addressContact.description", (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {text("country", "companyProfile.country")}
          {text("municipality", "companyProfile.municipality")}
          {text("postalCode", "companyProfile.postalCode")}
          {text("streetAddress", "companyProfile.streetAddress", { className: "sm:col-span-2" })}
          {text("addressLine2", "companyProfile.addressLine2")}
          {text("email", "companyProfile.email", { type: "email" })}
          {text("phone", "companyProfile.phone", { type: "tel" })}
          {text("website", "companyProfile.website", { type: "url", placeholder: "https://" })}
        </div>
      ))}

      {section("companyProfile.banking", "companyProfile.banking.description", (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text("bankName", "companyProfile.bankName")}
          {text("bankAccountHolder", "companyProfile.accountHolder")}
          {text("iban", "companyProfile.iban")}
          {text("swiftBic", "companyProfile.swiftBic")}
        </div>
      ))}

      {section("companyProfile.documents", "companyProfile.documents.description", (
        <div className="grid grid-cols-1 gap-3">
          {area("documentFooter", "companyProfile.documentFooter", "companyProfile.documentFooter.hint")}
          {area("paymentInstructions", "companyProfile.paymentInstructions", "companyProfile.paymentInstructions.hint")}
        </div>
      ))}
    </>
  );
}
