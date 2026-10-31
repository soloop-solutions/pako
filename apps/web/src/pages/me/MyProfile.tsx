import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { MyProfileResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { formatDate } from "@/pages/leave/leaveShared";

function ReadOnly({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value || "—"}</span>
    </div>
  );
}

// F9: what HR holds about me. Phone, address and email preferences save at once; a new bank
// account is only a request until HR approves it (salaries are paid there).
export function MyProfile() {
  const intl = useIntl();
  const { activeCompanyId: companyId } = useCompany();
  const queryClient = useQueryClient();
  const queryKey = ["me", "profile", companyId] as const;

  const profileQuery = useQuery({ queryKey, queryFn: () => apiClient.getMyProfile(companyId as string), enabled: !!companyId });
  const profile = profileQuery.data;

  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
  const [byEmail, setByEmail] = useState(false);
  const [language, setLanguage] = useState("sq");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setPhone(profile.phone ?? "");
    setAddress(profile.address ?? "");
    setIban(profile.iban ?? "");
    setBankName(profile.bankName ?? "");
    setByEmail(profile.receivePayslipsByEmail);
    setLanguage(profile.preferredLanguage);
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.updateMyProfile(companyId as string, {
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        iban: iban.replace(/\s+/g, "") || undefined,
        bankName: bankName.trim() || undefined,
        receivePayslipsByEmail: byEmail,
        preferredLanguage: language,
      }),
    onSuccess: (updated: MyProfileResponse) => {
      setError(null);
      setSaved(true);
      queryClient.setQueryData(queryKey, updated);
    },
    onError: (err: unknown) => {
      setSaved(false);
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "me.profile.saveError" })));
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    saveMutation.mutate();
  }

  if (!companyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }
  if (profileQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{getApiErrorMessage(profileQuery.error, intl.formatMessage({ id: "me.loadError" }))}</AlertDescription>
      </Alert>
    );
  }
  if (!profile) {
    return <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>;
  }

  const pending = profile.pendingBankChange;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{profile.name}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "me.profile.description" })}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ReadOnly label={intl.formatMessage({ id: "payroll.payslip.personalNumber" })} value={profile.personalNumber} />
          <ReadOnly label={intl.formatMessage({ id: "hr.employee.jobTitle" })} value={profile.jobTitle} />
          <ReadOnly label={intl.formatMessage({ id: "payroll.payslip.department" })} value={profile.departmentName} />
          <ReadOnly label={intl.formatMessage({ id: "me.profile.manager" })} value={profile.managerName} />
          <ReadOnly label={intl.formatMessage({ id: "me.profile.hireDate" })} value={formatDate(profile.hireDate)} />
          <ReadOnly label={intl.formatMessage({ id: "common.email" })} value={profile.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "me.profile.editTitle" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {saved && (
              <Alert>
                <AlertDescription>
                  {intl.formatMessage({ id: pending ? "me.profile.savedPending" : "me.profile.saved" })}
                </AlertDescription>
              </Alert>
            )}
            {pending && (
              <Alert>
                <AlertDescription>
                  {intl.formatMessage(
                    { id: "me.profile.pendingBank" },
                    { iban: pending.newIban, bank: pending.newBankName ?? "—", date: formatDate(pending.requestedAt) },
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="me-phone">{intl.formatMessage({ id: "me.profile.phone" })}</Label>
                <Input id="me-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="me-address">{intl.formatMessage({ id: "me.profile.address" })}</Label>
                <Input id="me-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="me-iban">IBAN</Label>
                <Input id="me-iban" value={iban} onChange={(e) => setIban(e.target.value)} className="font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="me-bank">{intl.formatMessage({ id: "me.profile.bankName" })}</Label>
                <Input id="me-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "me.profile.bankHint" })}</p>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={byEmail} onChange={(e) => setByEmail(e.target.checked)} />
              {intl.formatMessage({ id: "hr.employee.receivePayslipsByEmail" })}
            </label>
            <label className="flex items-center gap-2 text-sm">
              {intl.formatMessage({ id: "hr.employee.preferredLanguage" })}
              <select className="h-8 rounded-md border bg-transparent px-2 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="sq">Shqip</option>
                <option value="en">English</option>
              </select>
            </label>

            <div>
              <Button type="submit" disabled={saveMutation.isPending}>
                {intl.formatMessage({ id: saveMutation.isPending ? "common.saving" : "common.save" })}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
