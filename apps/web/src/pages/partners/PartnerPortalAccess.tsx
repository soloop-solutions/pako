import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Store } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useIsCompanyAdmin } from "@/hooks/useIsCompanyAdmin";

// Client feedback phase 5: a customer's portal logins, on the customer's own dialog. Company
// administrators invite a contact; the invitation creates a login that sees only the portal and
// only this customer. Deactivating or removing a login stays in Settings > Users.
export function PartnerPortalAccess({ companyId, partnerId }: { companyId: string; partnerId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const queryClient = useQueryClient();
  const { isAdmin } = useIsCompanyAdmin(companyId);
  const usersKey = ["admin", "users", companyId];
  const users = useQuery({ queryKey: usersKey, queryFn: () => apiClient.listCompanyUsers(companyId), enabled: isAdmin });
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => apiClient.inviteCompanyUser(companyId, {
      email: email.trim(),
      fullName: fullName.trim() || undefined,
      administrator: false,
      roleId: undefined,
      employeeId: undefined,
      partnerId,
    }),
    onSuccess: (result) => {
      setError(null);
      setEmail("");
      setFullName("");
      setInviteUrl(result.inviteUrl);
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("portal.inviteError"))),
  });

  if (!isAdmin) return null;
  const logins = (users.data ?? []).filter((u) => u.partnerId === partnerId);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setInviteUrl(null);
    invite.mutate();
  }

  return (
    <section className="mt-4 rounded-lg border p-4" aria-label={t("portal.accessTitle")}>
      <h3 className="mb-1 flex items-center gap-2 font-medium">
        <Store className="size-4" />
        {t("portal.accessTitle")}
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">{t("portal.accessHint")}</p>
      {logins.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {logins.map((u) => (
            <li key={u.membershipId ?? u.invitationId} className="flex items-center gap-2">
              <span>{u.fullName ?? u.email}</span>
              {u.fullName && <span className="text-muted-foreground">{u.email}</span>}
              <Badge variant="outline">{t(`admin.status.${u.status}`)}</Badge>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <FormField label={t("portal.inviteEmail")} htmlFor="portal-invite-email">
          <Input id="portal-invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label={t("portal.inviteName")} htmlFor="portal-invite-name">
          <Input id="portal-invite-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </FormField>
        <Button type="submit" variant="outline" disabled={invite.isPending || !email.trim()}>
          {t("portal.invite")}
        </Button>
      </form>
      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {inviteUrl && (
        <Alert className="mt-3">
          <AlertDescription>
            {t("portal.inviteSent")} <span className="break-all font-mono text-xs">{inviteUrl}</span>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
