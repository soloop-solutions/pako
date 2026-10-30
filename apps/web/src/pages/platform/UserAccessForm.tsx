import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";

export interface UserAccessValues {
  userId: string;
  companyLimit: number | null | undefined;
  isDisabled: boolean;
  isPlatformAdmin: boolean;
  companiesCreated: number;
}

// The three things a platform administrator controls per person: how many companies they may
// create, whether the account works at all, and whether they are an administrator too.
export function UserAccessForm({ user, onSaved, onCancel }: { user: UserAccessValues; onSaved: () => void; onCancel?: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const isSelf = auth?.userId === user.userId;
  const [unlimited, setUnlimited] = useState(user.companyLimit == null);
  const [limit, setLimit] = useState(String(user.companyLimit ?? Math.max(1, user.companiesCreated)));
  const [disabled, setDisabled] = useState(user.isDisabled);
  const [admin, setAdmin] = useState(user.isPlatformAdmin);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiClient.updatePlatformUser(user.userId, {
        // Administrators have no limit, whatever the box said.
        companyLimit: unlimited || admin ? undefined : Math.max(0, Math.floor(Number(limit) || 0)),
        isDisabled: disabled,
        isPlatformAdmin: admin,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["platform"] });
      onSaved();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("platform.user.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const below = !unlimited && Number(limit) < user.companiesCreated;

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="pu-limit">{t("platform.user.limit")}</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input id="pu-limit" type="number" min={0} className="w-28" value={limit} disabled={unlimited || admin} onChange={(e) => setLimit(e.target.value)} />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={unlimited || admin} disabled={admin} onChange={(e) => setUnlimited(e.target.checked)} />
            {t("platform.user.unlimited")}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("platform.user.limitHint", { used: intl.formatNumber(user.companiesCreated) })}
          {below && ` ${t("platform.user.limitBelow")}`}
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={disabled} disabled={isSelf} onChange={(e) => setDisabled(e.target.checked)} />
        <span>
          {t("platform.user.disable")}
          <span className="block text-xs text-muted-foreground">{t("platform.user.disableHint")}</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={admin} disabled={isSelf} onChange={(e) => setAdmin(e.target.checked)} />
        <span>
          {t("platform.user.admin")}
          <span className="block text-xs text-muted-foreground">{t("platform.user.adminHint")}</span>
        </span>
      </label>
      {isSelf && <p className="text-xs text-muted-foreground">{t("platform.user.selfHint")}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={save.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
