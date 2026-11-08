import { Building2, Clipboard, LockKeyhole, Mail, UserPlus } from "lucide-react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

type CompanyLimitNoticeProps = {
  used: number;
  limit: number;
  onBack?: () => void;
};

export function CompanyLimitNotice({ used, limit, onBack }: CompanyLimitNoticeProps) {
  const intl = useIntl();
  const { auth } = useAuth();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;

  async function copyRequest() {
    const message = t("lobby.limit.message", { email: auth?.email ?? "", used: String(used), limit: String(limit) });
    try {
      await navigator.clipboard.writeText(message);
      toast.success(t("lobby.limit.copied"));
    } catch {
      toast.message(message);
    }
  }

  return (
    <section
      role="status"
      className="flex flex-col gap-5 rounded-xl border border-warning-border bg-card p-6 sm:flex-row sm:gap-6"
      data-testid="company-limit-notice"
    >
      <div className="relative flex size-14 shrink-0 items-center justify-center rounded-xl border border-warning-border bg-warning text-warning-foreground">
        <Building2 className="size-7" />
        <span className="absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full border border-warning-border bg-card text-warning-foreground">
          <LockKeyhole className="size-3.5" />
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{t("lobby.limit.title")}</h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            {t("lobby.limit.body", { used: String(used), limit: String(limit) })}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>{t("lobby.limit.usage")}</span>
            <span className="tnum font-medium text-foreground">
              {used} / {limit}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-warning"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={used}
            aria-label={t("lobby.limit.usage")}
          >
            <div className="h-full rounded-full bg-warning-foreground" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">{t("lobby.limit.next")}</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex items-start gap-2">
              <Mail className="mt-0.5 size-4 shrink-0 text-primary" />
              {t("lobby.limit.step1")}
            </li>
            <li className="flex items-start gap-2">
              <UserPlus className="mt-0.5 size-4 shrink-0 text-primary" />
              {t("lobby.limit.step2")}
            </li>
          </ul>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void copyRequest()}>
            <Clipboard className="size-4" />
            {t("lobby.limit.copy")}
          </Button>
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack}>
              {t("lobby.limit.back")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
