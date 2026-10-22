import { useMemo, useState } from "react";
import type { CompanyResponse } from "@pako/shared";
import { Building2, Search } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";

export function CompanySelect() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { auth, logout } = useAuth();
  const { companies, loading, setActiveCompanyId } = useCompany();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const active = companies.filter((c) => !c.isArchived);
    const q = query.trim().toLowerCase();
    if (!q) return active;
    return active.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.businessNumber ?? "").toLowerCase().includes(q) ||
        (c.tradingName ?? "").toLowerCase().includes(q),
    );
  }, [companies, query]);

  function handleSelect(company: CompanyResponse) {
    setActiveCompanyId(company.id);
    navigate("/dashboard", { replace: true });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-6">
        <span className="text-sm font-semibold text-primary">PAKO</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{auth?.email}</span>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            {intl.formatMessage({ id: "common.logOut" })}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold">{intl.formatMessage({ id: "companySelect.title" })}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {intl.formatMessage({ id: "companySelect.subtitle" })}
          </p>
        </div>

        {companies.length > 3 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={intl.formatMessage({ id: "companySelect.search" })}
              className="pl-10"
            />
          </div>
        )}

        {companies.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <Building2 className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: "companySelect.noCompanies" })}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((company) => (
              <button
                key={company.id}
                type="button"
                onClick={() => handleSelect(company)}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border bg-card p-4 text-left transition-colors",
                  "hover:border-primary/40 hover:bg-primary/5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 shrink-0 text-primary" />
                  <span className="text-sm font-semibold">{company.name}</span>
                </div>
                {company.tradingName && company.tradingName !== company.name && (
                  <span className="pl-6 text-xs text-muted-foreground">{company.tradingName}</span>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-6">
                  {company.businessNumber && (
                    <span className="text-xs text-muted-foreground">
                      {intl.formatMessage({ id: "companySelect.businessNumber" })}: {company.businessNumber}
                    </span>
                  )}
                  {company.municipality && (
                    <span className="text-xs text-muted-foreground">
                      {intl.formatMessage({ id: "companySelect.municipality" })}: {company.municipality}
                    </span>
                  )}
                </div>
              </button>
            ))}
            {filtered.length === 0 && query && (
              <p className="col-span-full text-center text-sm text-muted-foreground">
                {intl.formatMessage({ id: "common.noResults" })}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
