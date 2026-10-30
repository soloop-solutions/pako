import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";

import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { cn } from "@/lib/utils";
import { RolesTab } from "@/pages/admin/RolesTab";
import { UsersTab } from "@/pages/admin/UsersTab";

const TABS = ["users", "roles"] as const;

// docs/USER_ACCESS_PLAN.md: the administration dashboard — who can sign in, and what each role
// may see and do. Company and firm admins (or a role with Users: Approve) manage it; a role with
// Users: View can look.
export function UsersAndRoles() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const { access } = useMyAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "roles" ? "roles" : "users";

  if (!activeCompanyId) return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  const canManage = access?.canManageUsers ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "nav.usersAndRoles" })}</h2>
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "nav.usersAndRoles.description" })}</p>
      </div>
      <div role="tablist" aria-label={intl.formatMessage({ id: "nav.usersAndRoles" })} className="flex gap-1 border-b">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setSearchParams(id === "users" ? {} : { tab: id }, { replace: true })}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {intl.formatMessage({ id: `admin.tab.${id}` })}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "users" ? <UsersTab companyId={activeCompanyId} canManage={canManage} /> : <RolesTab companyId={activeCompanyId} canManage={canManage} />}
      </div>
    </div>
  );
}
