import { useQuery } from "@tanstack/react-query";
import type { AccountantUsageResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { MODULES } from "@/pages/platform/PlatformCompaniesTab";
import { UserAccessForm } from "@/pages/platform/UserAccessForm";

// One accountant: the companies they created with what each has done, and their access settings.
export function AccountantDialog({ accountant, onClose }: { accountant: AccountantUsageResponse; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const companies = useQuery({
    queryKey: ["platform", "companies", "by", accountant.userId],
    queryFn: () => apiClient.listPlatformCompanies(undefined, accountant.userId, 1, 200),
  });
  const n = (v: number) => intl.formatNumber(v);

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={accountant.fullName ?? accountant.email} description={accountant.email} size="lg">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("platform.accountant.companies")}</h3>
          {(companies.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{companies.isPending ? t("platform.loading") : t("platform.accountant.noCompanies")}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {companies.data!.items.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">
                    {c.name}
                    {c.isArchived && <Badge variant="secondary" className="ml-2">{t("companies.archived")}</Badge>}
                  </span>
                  <span className="flex flex-wrap gap-x-4 text-xs text-muted-foreground tnum">
                    <span>{t("platform.col.users")}: {n(c.users)}</span>
                    <span>{t("platform.col.invoices")}: {n(c.postedInvoices)}</span>
                    <span>{t("platform.col.employees")}: {n(c.employees)}</span>
                    <span>{t("platform.col.modules")}: {c.modules.length}/{MODULES.length}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{t("platform.accountant.access")}</h3>
          <UserAccessForm
            user={{
              userId: accountant.userId,
              companyLimit: accountant.companyLimit,
              isDisabled: accountant.isDisabled,
              isPlatformAdmin: accountant.isPlatformAdmin,
              companiesCreated: accountant.companiesCreated,
            }}
            onSaved={onClose}
            onCancel={onClose}
          />
        </section>
      </div>
    </FormDialog>
  );
}
