import { useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";

const LEGAL_FORM_OPTIONS = [
  { value: 0, labelKey: "companyProfile.legalForm.individual" },
  { value: 1, labelKey: "companyProfile.legalForm.shpk" },
  { value: 2, labelKey: "companyProfile.legalForm.sha" },
  { value: 3, labelKey: "companyProfile.legalForm.shk" },
  { value: 4, labelKey: "companyProfile.legalForm.shkKomandite" },
  { value: 5, labelKey: "companyProfile.legalForm.oe" },
  { value: 6, labelKey: "companyProfile.legalForm.ngo" },
  { value: 7, labelKey: "companyProfile.legalForm.publicEntity" },
  { value: 99, labelKey: "companyProfile.legalForm.other" },
] as const;

export function CompanyProfile() {
  const intl = useIntl();
  const { activeCompany, refresh } = useCompany();
  const companyId = activeCompany?.id ?? null;

  // General
  const [name, setName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [legalForm, setLegalForm] = useState<number | null>(null);
  const [businessActivity, setBusinessActivity] = useState("");
  const [description, setDescription] = useState("");

  // Legal & Fiscal
  const [businessNumber, setBusinessNumber] = useState("");
  const [fiscalNumber, setFiscalNumber] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [vatRegistrationDate, setVatRegistrationDate] = useState("");

  // Address & Contact
  const [country, setCountry] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");

  // Banking
  const [bankName, setBankName] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [iban, setIban] = useState("");
  const [swiftBic, setSwiftBic] = useState("");

  // Document & Branding
  const [documentFooter, setDocumentFooter] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Reset form when active company changes
  useEffect(() => {
    if (!activeCompany) return;
    setName(activeCompany.name ?? "");
    setTradingName(activeCompany.tradingName ?? "");
    setLegalForm(activeCompany.legalForm ?? null);
    setBusinessActivity(activeCompany.businessActivity ?? "");
    setDescription(activeCompany.description ?? "");
    setBusinessNumber(activeCompany.businessNumber ?? "");
    setFiscalNumber(activeCompany.fiscalNumber ?? "");
    setVatNumber(activeCompany.vatNumber ?? "");
    setVatRegistrationDate(activeCompany.vatRegistrationDate ?? "");
    setCountry(activeCompany.country ?? "Kosovo");
    setMunicipality(activeCompany.municipality ?? "");
    setStreetAddress(activeCompany.streetAddress ?? "");
    setPostalCode(activeCompany.postalCode ?? "");
    setAddressLine2(activeCompany.addressLine2 ?? "");
    setEmail(activeCompany.email ?? "");
    setPhone(activeCompany.phone ?? "");
    setWebsite(activeCompany.website ?? "");
    setBankName(activeCompany.bankName ?? "");
    setBankAccountHolder(activeCompany.bankAccountHolder ?? "");
    setIban(activeCompany.iban ?? "");
    setSwiftBic(activeCompany.swiftBic ?? "");
    setDocumentFooter(activeCompany.documentFooter ?? "");
    setPaymentInstructions(activeCompany.paymentInstructions ?? "");
    setDirty(false);
  }, [activeCompany]);

  function field<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.profile(companyId, {
        name: name.trim(),
        tradingName: tradingName.trim() || undefined,
        legalForm: legalForm ?? undefined,
        businessActivity: businessActivity.trim() || undefined,
        description: description.trim() || undefined,
        businessNumber: businessNumber.trim() || undefined,
        fiscalNumber: fiscalNumber.trim() || undefined,
        vatNumber: vatNumber.trim() || undefined,
        vatRegistrationDate: vatRegistrationDate || undefined,
        country: country.trim() || undefined,
        municipality: municipality.trim() || undefined,
        streetAddress: streetAddress.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        bankName: bankName.trim() || undefined,
        bankAccountHolder: bankAccountHolder.trim() || undefined,
        iban: iban.trim() || undefined,
        swiftBic: swiftBic.trim() || undefined,
        documentFooter: documentFooter.trim() || undefined,
        paymentInstructions: paymentInstructions.trim() || undefined,
      });
      await refresh();
      setDirty(false);
      toast.success(intl.formatMessage({ id: "companyProfile.saved" }));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "companyProfile.saveError" })));
    } finally {
      setSaving(false);
    }
  }

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        {intl.formatMessage({ id: "common.selectCompanyFirst" })}
      </p>
    );
  }

  const isArchived = activeCompany.isArchived;

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSave}>
      {isArchived && (
        <Alert>
          <AlertDescription>{intl.formatMessage({ id: "companyProfile.archivedBanner" })}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Section 1: General Information */}
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "companyProfile.general" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "companyProfile.general.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-name">{intl.formatMessage({ id: "companyProfile.name" })} *</Label>
              <Input
                id="cp-name"
                required
                value={name}
                onChange={(e) => field(setName)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-tradingName">{intl.formatMessage({ id: "companyProfile.tradingName" })}</Label>
              <Input
                id="cp-tradingName"
                value={tradingName}
                onChange={(e) => field(setTradingName)(e.target.value)}
                placeholder={intl.formatMessage({ id: "companyProfile.tradingName.hint" })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-legalForm">{intl.formatMessage({ id: "companyProfile.legalForm" })}</Label>
              <Select
                id="cp-legalForm"
                value={String(legalForm ?? "")}
                onValueChange={(v) => {
                  setLegalForm(v ? Number(v) : null);
                  setDirty(true);
                }}
                placeholder={intl.formatMessage({ id: "companyProfile.legalForm.placeholder" })}
                options={LEGAL_FORM_OPTIONS.map((o) => ({
                  value: String(o.value),
                  label: intl.formatMessage({ id: o.labelKey }),
                }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-businessActivity">{intl.formatMessage({ id: "companyProfile.businessActivity" })}</Label>
              <Input
                id="cp-businessActivity"
                value={businessActivity}
                onChange={(e) => field(setBusinessActivity)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="cp-description">{intl.formatMessage({ id: "companyProfile.description" })}</Label>
              <Textarea
                id="cp-description"
                value={description}
                onChange={(e) => field(setDescription)(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Legal & Fiscal Information */}
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "companyProfile.legalFiscal" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "companyProfile.legalFiscal.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-businessNumber">{intl.formatMessage({ id: "companyProfile.businessNumber" })}</Label>
              <Input
                id="cp-businessNumber"
                value={businessNumber}
                onChange={(e) => field(setBusinessNumber)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-fiscalNumber">{intl.formatMessage({ id: "companyProfile.fiscalNumber" })}</Label>
              <Input
                id="cp-fiscalNumber"
                value={fiscalNumber}
                onChange={(e) => field(setFiscalNumber)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-vatNumber">{intl.formatMessage({ id: "companyProfile.vatNumber" })}</Label>
              <Input
                id="cp-vatNumber"
                value={vatNumber}
                onChange={(e) => field(setVatNumber)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-vatRegistered">{intl.formatMessage({ id: "companyProfile.vatRegistered" })}</Label>
              <Input
                id="cp-vatRegistered"
                readOnly
                disabled
                value={
                  activeCompany.isVatRegistered
                    ? intl.formatMessage({ id: "companyProfile.vatRegistered.yes" })
                    : intl.formatMessage({ id: "companyProfile.vatRegistered.no" })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-vatRegistrationDate">{intl.formatMessage({ id: "companyProfile.vatRegistrationDate" })}</Label>
              <Input
                id="cp-vatRegistrationDate"
                type="date"
                value={vatRegistrationDate}
                onChange={(e) => field(setVatRegistrationDate)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-currency">{intl.formatMessage({ id: "companyProfile.currency" })}</Label>
              <Input
                id="cp-currency"
                readOnly
                disabled
                value={activeCompany.functionalCurrency}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Address & Contact */}
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "companyProfile.addressContact" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "companyProfile.addressContact.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-country">{intl.formatMessage({ id: "companyProfile.country" })}</Label>
              <Input
                id="cp-country"
                value={country}
                onChange={(e) => field(setCountry)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-municipality">{intl.formatMessage({ id: "companyProfile.municipality" })}</Label>
              <Input
                id="cp-municipality"
                value={municipality}
                onChange={(e) => field(setMunicipality)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-postalCode">{intl.formatMessage({ id: "companyProfile.postalCode" })}</Label>
              <Input
                id="cp-postalCode"
                value={postalCode}
                onChange={(e) => field(setPostalCode)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="cp-streetAddress">{intl.formatMessage({ id: "companyProfile.streetAddress" })}</Label>
              <Input
                id="cp-streetAddress"
                value={streetAddress}
                onChange={(e) => field(setStreetAddress)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-addressLine2">{intl.formatMessage({ id: "companyProfile.addressLine2" })}</Label>
              <Input
                id="cp-addressLine2"
                value={addressLine2}
                onChange={(e) => field(setAddressLine2)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-email">{intl.formatMessage({ id: "companyProfile.email" })}</Label>
              <Input
                id="cp-email"
                type="email"
                value={email}
                onChange={(e) => field(setEmail)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-phone">{intl.formatMessage({ id: "companyProfile.phone" })}</Label>
              <Input
                id="cp-phone"
                type="tel"
                value={phone}
                onChange={(e) => field(setPhone)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-website">{intl.formatMessage({ id: "companyProfile.website" })}</Label>
              <Input
                id="cp-website"
                type="url"
                value={website}
                onChange={(e) => field(setWebsite)(e.target.value)}
                placeholder="https://"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 4: Banking & Payment Details */}
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "companyProfile.banking" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "companyProfile.banking.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-bankName">{intl.formatMessage({ id: "companyProfile.bankName" })}</Label>
              <Input
                id="cp-bankName"
                value={bankName}
                onChange={(e) => field(setBankName)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-accountHolder">{intl.formatMessage({ id: "companyProfile.accountHolder" })}</Label>
              <Input
                id="cp-accountHolder"
                value={bankAccountHolder}
                onChange={(e) => field(setBankAccountHolder)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-iban">{intl.formatMessage({ id: "companyProfile.iban" })}</Label>
              <Input
                id="cp-iban"
                value={iban}
                onChange={(e) => field(setIban)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-swiftBic">{intl.formatMessage({ id: "companyProfile.swiftBic" })}</Label>
              <Input
                id="cp-swiftBic"
                value={swiftBic}
                onChange={(e) => field(setSwiftBic)(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 5: Document & Branding */}
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "companyProfile.documents" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "companyProfile.documents.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-documentFooter">{intl.formatMessage({ id: "companyProfile.documentFooter" })}</Label>
              <Textarea
                id="cp-documentFooter"
                value={documentFooter}
                onChange={(e) => field(setDocumentFooter)(e.target.value)}
                placeholder={intl.formatMessage({ id: "companyProfile.documentFooter.hint" })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cp-paymentInstructions">{intl.formatMessage({ id: "companyProfile.paymentInstructions" })}</Label>
              <Textarea
                id="cp-paymentInstructions"
                value={paymentInstructions}
                onChange={(e) => field(setPaymentInstructions)(e.target.value)}
                placeholder={intl.formatMessage({ id: "companyProfile.paymentInstructions.hint" })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button type="submit" disabled={saving || !dirty || isArchived}>
          {saving
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: "common.save" })}
        </Button>
        {dirty && (
          <span className="text-xs text-muted-foreground">
            {intl.formatMessage({ id: "companyProfile.unsavedChanges" })}
          </span>
        )}
      </div>
    </form>
  );
}
