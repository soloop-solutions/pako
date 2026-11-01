import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { Upload, X, Plus, Trash2, Star } from "lucide-react";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LEGAL_FORM_OPTIONS, type CompanyProfileValues } from "@/lib/company-profile";
import type { CompanyBankAccountResponse } from "@pako/shared";
import { toast } from "sonner";

// Every company detail, in the five sections of Settings → Company profile. Used there (as cards)
// and in the lobby's "New company" dialog (as plain sections), so both ask for the same fields.
/** A bank account entry collected locally before the company exists. */
export type PendingBankAccount = { bankName: string; accountHolder: string; iban: string; swiftBic: string };

export function CompanyProfileFields({
  values,
  onChange,
  idPrefix = "cp",
  variant = "cards",
  vatRegistered,
  onVatRegisteredChange,
  currency,
  companyId,
  logoUrl,
  stampUrl,
  onBrandingChange,
  pendingLogo,
  onPendingLogoChange,
  pendingStamp,
  onPendingStampChange,
  pendingBankAccounts,
  onPendingBankAccountsChange,
}: {
  values: CompanyProfileValues;
  onChange: (patch: Partial<CompanyProfileValues>) => void;
  idPrefix?: string;
  variant?: "cards" | "plain";
  vatRegistered: boolean;
  /** When given, VAT registration is chosen here (new company); otherwise it is read-only. */
  onVatRegisteredChange?: (value: boolean) => void;
  currency: string;
  companyId?: string;
  logoUrl?: string | null;
  stampUrl?: string | null;
  onBrandingChange?: () => void;
  /** Local file selected for logo before the company exists. */
  pendingLogo?: File | null;
  onPendingLogoChange?: (file: File | null) => void;
  /** Local file selected for stamp before the company exists. */
  pendingStamp?: File | null;
  onPendingStampChange?: (file: File | null) => void;
  /** Local bank account entries before the company exists. */
  pendingBankAccounts?: PendingBankAccount[];
  onPendingBankAccountsChange?: (accounts: PendingBankAccount[]) => void;
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

      {section("companyProfile.branding", "companyProfile.branding.description", (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {companyId ? (
            <>
              <ImageUpload
                label={t("companyProfile.logo")}
                imageUrl={logoUrl}
                onUpload={(file) => apiClient.logoPOST(companyId, { data: file, fileName: file.name }).then(() => onBrandingChange?.())}
                onDelete={() => apiClient.logoDELETE(companyId).then(() => onBrandingChange?.())}
              />
              <ImageUpload
                label={t("companyProfile.stamp")}
                imageUrl={stampUrl}
                onUpload={(file) => apiClient.stampPOST(companyId, { data: file, fileName: file.name }).then(() => onBrandingChange?.())}
                onDelete={() => apiClient.stampDELETE(companyId).then(() => onBrandingChange?.())}
              />
            </>
          ) : (
            <>
              <LocalImagePick label={t("companyProfile.logo")} file={pendingLogo ?? null} onFileChange={(f) => onPendingLogoChange?.(f)} />
              <LocalImagePick label={t("companyProfile.stamp")} file={pendingStamp ?? null} onFileChange={(f) => onPendingStampChange?.(f)} />
            </>
          )}
        </div>
      ))}

      {section("companyProfile.legalFiscal", "companyProfile.legalFiscal.description", (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {text("businessNumber", "companyProfile.businessNumber")}
          {text("fiscalNumber", "companyProfile.fiscalNumber")}
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
              <Input id={id("vatRegistered")} readOnly disabled value={t(vatRegistered ? "companyProfile.vatRegistered.yes" : "companyProfile.vatRegistered.no")} />
            )}
          </div>
          {vatRegistered && text("vatNumber", "companyProfile.vatNumber")}
          {vatRegistered && text("vatRegistrationDate", "companyProfile.vatRegistrationDate", { type: "date" })}
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

      {companyId && section("companyProfile.banking", "companyProfile.banking.description", (
        <BankAccountsSection companyId={companyId} />
      ))}

      {!companyId && pendingBankAccounts && onPendingBankAccountsChange && section("companyProfile.banking", "companyProfile.banking.description", (
        <PendingBankAccountsSection accounts={pendingBankAccounts} onChange={onPendingBankAccountsChange} />
      ))}

      {!companyId && !pendingBankAccounts && section("companyProfile.banking", "companyProfile.banking.description", (
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

function ImageUpload({
  label,
  imageUrl,
  onUpload,
  onDelete,
}: {
  label: string;
  imageUrl?: string | null;
  onUpload: (file: File) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const intl = useIntl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const baseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:5248";
  const fullUrl = imageUrl ? `${baseUrl}${imageUrl}` : null;

  async function handleFile(file: File) {
    setUploading(true);
    try {
      await onUpload(file);
      toast.success(intl.formatMessage({ id: "companyProfile.imageUploaded" }));
    } catch (err) {
      toast.error(getApiErrorMessage(err, intl.formatMessage({ id: "companyProfile.imageUploadError" })));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete() {
    try {
      await onDelete();
      toast.success(intl.formatMessage({ id: "companyProfile.imageDeleted" }));
    } catch (err) {
      toast.error(getApiErrorMessage(err, intl.formatMessage({ id: "companyProfile.imageDeleteError" })));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {fullUrl ? (
        <div className="relative inline-block w-fit">
          <img src={fullUrl} alt={label} className="h-24 max-w-48 rounded border object-contain" />
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground hover:bg-destructive/80"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex h-24 w-48 items-center justify-center rounded border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Upload className="mr-2 h-4 w-4" />
          {uploading ? intl.formatMessage({ id: "common.uploading" }) : intl.formatMessage({ id: "companyProfile.uploadImage" })}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}

/** Pick a local file and show a preview — no upload, just collects the File object. */
function LocalImagePick({ label, file, onFileChange }: { label: string; file: File | null; onFileChange: (f: File | null) => void }) {
  const intl = useIntl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {preview ? (
        <div className="relative inline-block w-fit">
          <img src={preview} alt={label} className="h-24 max-w-48 rounded border object-contain" />
          <button
            type="button"
            onClick={() => { onFileChange(null); if (inputRef.current) inputRef.current.value = ""; }}
            className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground hover:bg-destructive/80"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-24 w-48 items-center justify-center rounded border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Upload className="mr-2 h-4 w-4" />
          {intl.formatMessage({ id: "companyProfile.uploadImage" })}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChange(f); }}
      />
    </div>
  );
}

/** Local-only multi-bank input for the creation dialog (no API calls). */
function PendingBankAccountsSection({ accounts, onChange }: { accounts: PendingBankAccount[]; onChange: (a: PendingBankAccount[]) => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [adding, setAdding] = useState(false);
  const [newBank, setNewBank] = useState<PendingBankAccount>({ bankName: "", accountHolder: "", iban: "", swiftBic: "" });

  function add() {
    if (!newBank.bankName.trim()) return;
    onChange([...accounts, { bankName: newBank.bankName.trim(), accountHolder: newBank.accountHolder.trim(), iban: newBank.iban.trim(), swiftBic: newBank.swiftBic.trim() }]);
    setNewBank({ bankName: "", accountHolder: "", iban: "", swiftBic: "" });
    setAdding(false);
  }

  function remove(index: number) {
    onChange(accounts.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {accounts.map((acc, i) => (
        <div key={i} className="flex items-start gap-3 rounded border p-3">
          <div className="flex-1 grid grid-cols-1 gap-1 sm:grid-cols-2 text-sm">
            <div><span className="font-medium">{acc.bankName}</span></div>
            {acc.accountHolder && <div className="text-muted-foreground">{acc.accountHolder}</div>}
            {acc.iban && <div className="font-mono text-xs">{acc.iban}</div>}
            {acc.swiftBic && <div className="text-muted-foreground text-xs">{acc.swiftBic}</div>}
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(i)} title={t("common.delete")}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="rounded border p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label>{t("companyProfile.bankName")} *</Label>
              <Input value={newBank.bankName} onChange={(e) => setNewBank((b) => ({ ...b, bankName: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("companyProfile.accountHolder")}</Label>
              <Input value={newBank.accountHolder} onChange={(e) => setNewBank((b) => ({ ...b, accountHolder: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("companyProfile.iban")}</Label>
              <Input value={newBank.iban} onChange={(e) => setNewBank((b) => ({ ...b, iban: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("companyProfile.swiftBic")}</Label>
              <Input value={newBank.swiftBic} onChange={(e) => setNewBank((b) => ({ ...b, swiftBic: e.target.value }))} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" onClick={add} disabled={!newBank.bankName.trim()}>
              {t("common.save")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t("companyProfile.addBankAccount")}
        </Button>
      )}
    </div>
  );
}

function BankAccountsSection({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [accounts, setAccounts] = useState<CompanyBankAccountResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newBank, setNewBank] = useState({ bankName: "", accountHolder: "", iban: "", swiftBic: "" });

  useEffect(() => {
    void loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function loadAccounts() {
    try {
      const data = await apiClient.bankAccountsAll(companyId);
      setAccounts(data);
    } finally {
      setLoading(false);
    }
  }

  async function addAccount() {
    if (!newBank.bankName.trim()) return;
    try {
      await apiClient.bankAccountsPOST(companyId, {
        bankName: newBank.bankName.trim(),
        accountHolder: newBank.accountHolder.trim() || undefined,
        iban: newBank.iban.trim() || undefined,
        swiftBic: newBank.swiftBic.trim() || undefined,
        isDefault: accounts.length === 0,
      });
      setNewBank({ bankName: "", accountHolder: "", iban: "", swiftBic: "" });
      setAdding(false);
      await loadAccounts();
      toast.success(t("companyProfile.bankAccountAdded"));
    } catch (err) {
      toast.error(getApiErrorMessage(err, t("companyProfile.bankAccountError")));
    }
  }

  async function deleteAccount(id: string) {
    try {
      await apiClient.bankAccountsDELETE(companyId, id);
      await loadAccounts();
      toast.success(t("companyProfile.bankAccountDeleted"));
    } catch (err) {
      toast.error(getApiErrorMessage(err, t("companyProfile.bankAccountError")));
    }
  }

  async function setDefault(id: string) {
    try {
      await apiClient.bankAccountsPUT(companyId, id, { isDefault: true });
      await loadAccounts();
    } catch (err) {
      toast.error(getApiErrorMessage(err, t("companyProfile.bankAccountError")));
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {accounts.map((acc) => (
        <div key={acc.id} className="flex items-start gap-3 rounded border p-3">
          <div className="flex-1 grid grid-cols-1 gap-1 sm:grid-cols-2 text-sm">
            <div>
              <span className="font-medium">{acc.bankName}</span>
              {acc.isDefault && (
                <span className="ml-2 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                  {t("companyProfile.defaultBank")}
                </span>
              )}
            </div>
            {acc.accountHolder && <div className="text-muted-foreground">{acc.accountHolder}</div>}
            {acc.iban && <div className="font-mono text-xs">{acc.iban}</div>}
            {acc.swiftBic && <div className="text-muted-foreground text-xs">{acc.swiftBic}</div>}
          </div>
          <div className="flex gap-1">
            {!acc.isDefault && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void setDefault(acc.id)} title={t("companyProfile.setDefault")}>
                <Star className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => void deleteAccount(acc.id)} title={t("common.delete")}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="rounded border p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label>{t("companyProfile.bankName")} *</Label>
              <Input value={newBank.bankName} onChange={(e) => setNewBank((b) => ({ ...b, bankName: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("companyProfile.accountHolder")}</Label>
              <Input value={newBank.accountHolder} onChange={(e) => setNewBank((b) => ({ ...b, accountHolder: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("companyProfile.iban")}</Label>
              <Input value={newBank.iban} onChange={(e) => setNewBank((b) => ({ ...b, iban: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("companyProfile.swiftBic")}</Label>
              <Input value={newBank.swiftBic} onChange={(e) => setNewBank((b) => ({ ...b, swiftBic: e.target.value }))} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" onClick={() => void addAccount()} disabled={!newBank.bankName.trim()}>
              {t("common.save")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t("companyProfile.addBankAccount")}
        </Button>
      )}
    </div>
  );
}
