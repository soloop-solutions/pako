import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MembershipResponse, PackageResponse } from "@pako/shared";
import { CheckCircle2, XCircle } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { MembershipState, membershipStateKey, packageUsable } from "@/lib/pos-services";
import { cn } from "@/lib/utils";

const money = (v: number | undefined) => (v ?? 0).toFixed(2);

// docs/POS_PLAN.md P4: a session from a package — scan or type the package number (or the holder's
// name or phone); the server prices the line at the package's value and pays it from the package.
export function TillPackageDialog({ onUse, onClose }: { onUse: (pkg: PackageResponse) => void; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const packages = useQuery({
    queryKey: ["posPackages", activeCompanyId, search],
    queryFn: () => apiClient.listPosPackages(activeCompanyId as string, search as string),
    enabled: !!activeCompanyId && !!search,
    retry: false,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (typed.trim()) setSearch(typed.trim());
  }

  const rows = packages.data ?? [];
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("svc.till.package.title")} size="md">
      <div className="flex flex-col gap-3">
        <form className="flex items-end gap-2" onSubmit={submit}>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="till-package">{t("svc.till.package.number")}</Label>
            <Input id="till-package" autoFocus autoComplete="off" maxLength={60} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <Button type="submit" disabled={!typed.trim()}>{t("svc.till.find")}</Button>
        </form>
        {packages.error && <p className="text-sm text-destructive">{getApiErrorMessage(packages.error, t("svc.till.package.notFound"))}</p>}
        {search && packages.data && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("svc.till.package.notFound")}</p>}
        <ul className="flex flex-col gap-2" data-testid="till-packages">
          {rows.map((p) => {
            const usable = packageUsable(p);
            return (
              <li key={p.id} className={cn("flex items-center justify-between gap-2 rounded-md border p-2 text-sm", !usable && "text-muted-foreground")}>
                <div className="flex flex-col">
                  <span className="font-medium">{p.number} · {p.serviceName}</span>
                  <span className="text-xs">
                    {p.holderName ?? "—"}{p.phone ? ` · ${p.phone}` : ""}
                  </span>
                  <span className="text-xs tabular-nums">
                    {t("svc.till.package.left", { left: p.sessionsLeft, total: p.sessionsTotal })}
                    {p.expiresOn ? ` · ${t("svc.till.package.expires", { date: p.expiresOn })}` : ""}
                    {` · ${t("svc.till.package.value", { amount: money(p.unitValue) })}`}
                  </span>
                </div>
                {usable ? (
                  <Button size="sm" onClick={() => onUse(p)}>{t("svc.till.package.use")}</Button>
                ) : (
                  <Badge variant="secondary">{t("svc.till.package.unusable")}</Badge>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

/** Whether a membership is active today, big and in colour (green/red) — the server's answer. */
export function MembershipStatus({ membership: m }: { membership: MembershipResponse }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  return (
    <div
      data-testid="membership-status"
      className={cn(
        "flex items-center gap-3 rounded-md border-2 p-3",
        m.activeToday ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100" : "border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950/60 dark:text-rose-100",
      )}
    >
      {m.activeToday ? <CheckCircle2 className="size-8 shrink-0" /> : <XCircle className="size-8 shrink-0" />}
      <div className="flex flex-col">
        <span className="text-lg font-bold">
          {m.activeToday ? t("svc.member.activeUntil", { date: m.endsOn }) : t("svc.member.notActive", { date: m.endsOn })}
        </span>
        <span className="text-sm">
          {m.number} · {m.planName} · {m.holderName ?? "—"}
          {m.state !== MembershipState.Active ? ` · ${t(`svc.member.state.${membershipStateKey(m.state)}`)}` : ""}
        </span>
      </div>
    </div>
  );
}

// P4: a member's card at the till — shows whether it is active today and renews it (adds the plan
// item with the membership number; the server extends it).
export function TillMembershipDialog({ onRenew, onClose }: { onRenew: (m: MembershipResponse) => void; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [typed, setTyped] = useState("");
  const [number, setNumber] = useState<string | null>(null);
  const membership = useQuery({
    queryKey: ["posMembership", activeCompanyId, number],
    queryFn: () => apiClient.checkPosMembership(activeCompanyId as string, number as string),
    enabled: !!activeCompanyId && !!number,
    retry: false,
  });
  const m = membership.data;
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("svc.till.membership.title")} size="sm">
      <div className="flex flex-col gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) setNumber(typed.trim());
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="till-membership">{t("svc.member.number")}</Label>
            <Input id="till-membership" autoFocus autoComplete="off" maxLength={40} value={typed} onChange={(e) => setTyped(e.target.value)} className="tabular-nums" />
          </div>
          <Button type="submit" disabled={!typed.trim()}>{t("svc.member.check")}</Button>
        </form>
        {number && membership.error && <p className="text-sm text-destructive">{t("svc.member.notFound", { number })}</p>}
        {m && <MembershipStatus membership={m} />}
        <p className="text-xs text-muted-foreground">{t("svc.till.membership.hint")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={!m || m.state === MembershipState.Cancelled} onClick={() => m && onRenew(m)}>{t("svc.till.membership.renew")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}
