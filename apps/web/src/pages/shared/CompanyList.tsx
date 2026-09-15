import { useMemo, useState } from "react";
import { useIntl } from "react-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { getLastOpenedMap } from "@/lib/company-last-opened";
import { MembersPanel } from "@/pages/shared/MembersPanel";

type CompanyListProps = {
  titleKey?: string;
  descriptionKey?: string;
};

export function CompanyList({ titleKey = "companies.title", descriptionKey = "companies.description" }: CompanyListProps) {
  const intl = useIntl();
  const { auth } = useAuth();
  const { companies, activeCompanyId, loading, error, setActiveCompanyId } = useCompany();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const visibleCompanies = useMemo(() => {
    const lastOpened = auth ? getLastOpenedMap(auth.userId) : {};
    const query = search.trim().toLowerCase();
    const filtered = query ? companies.filter((company) => company.name.toLowerCase().includes(query)) : companies;
    return [...filtered].sort((a, b) => {
      const aOpened = lastOpened[a.id];
      const bOpened = lastOpened[b.id];
      if (aOpened && bOpened) return bOpened.localeCompare(aOpened);
      if (aOpened) return -1;
      if (bOpened) return 1;
      return a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, search, auth, activeCompanyId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: titleKey })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: descriptionKey })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {companies.length > 0 && (
          <Input
            className="max-w-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={intl.formatMessage({ id: "companies.searchPlaceholder" })}
            aria-label={intl.formatMessage({ id: "companies.searchPlaceholder" })}
          />
        )}
        {loading && companies.length === 0 && (
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "companies.loadingCompanies" })}</p>
        )}
        {!loading && companies.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "companies.noCompanies" })}</p>
        )}
        {!loading && companies.length > 0 && visibleCompanies.length === 0 && (
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "companies.noSearchResults" })}</p>
        )}
        {visibleCompanies.map((company) => {
          const key = `company:${company.id}`;
          return (
            <div key={company.id} className="flex flex-col gap-3 rounded-md border px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{company.name}</span>
                  {company.id === activeCompanyId && <Badge>{intl.formatMessage({ id: "common.active" })}</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleExpanded(key)}>
                    {expanded.has(key)
                      ? intl.formatMessage({ id: "companies.hideMembers" })
                      : intl.formatMessage({ id: "companies.members" })}
                  </Button>
                  <Button
                    variant={company.id === activeCompanyId ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setActiveCompanyId(company.id)}
                    disabled={company.id === activeCompanyId}
                  >
                    {company.id === activeCompanyId
                      ? intl.formatMessage({ id: "common.active" })
                      : intl.formatMessage({ id: "companies.setActive" })}
                  </Button>
                </div>
              </div>
              {expanded.has(key) && <MembersPanel scope="company" scopeId={company.id} />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
