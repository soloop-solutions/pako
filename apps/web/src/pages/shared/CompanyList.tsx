import { useCallback, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
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
  const { companies, activeCompanyId, loading, error, refresh } = useCompany();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<{ id: string; name: string; isArchived: boolean } | null>(null);

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

  const handleArchiveToggle = useCallback(
    async (companyId: string, _companyName: string, currentlyArchived: boolean) => {
      setArchiving(companyId);
      try {
        if (currentlyArchived) {
          await apiClient.unarchive(companyId);
          toast.success(intl.formatMessage({ id: "companies.unarchiveSuccess" }));
        } else {
          await apiClient.archive(companyId);
          toast.success(intl.formatMessage({ id: "companies.archiveSuccess" }));
        }
        await refresh();
      } catch (err) {
        const msgKey = currentlyArchived ? "companies.unarchiveError" : "companies.archiveError";
        toast.error(getApiErrorMessage(err, intl.formatMessage({ id: msgKey })));
      } finally {
        setArchiving(null);
        setConfirmArchive(null);
      }
    },
    [intl, refresh],
  );

  const visibleCompanies = useMemo(() => {
    const lastOpened = auth ? getLastOpenedMap(auth.userId) : {};
    const query = search.trim().toLowerCase();
    let filtered = query ? companies.filter((company) => company.name.toLowerCase().includes(query)) : companies;
    if (!showArchived) {
      filtered = filtered.filter((c) => !c.isArchived);
    }
    return [...filtered].sort((a, b) => {
      // Archived companies sort to the bottom
      if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
      const aOpened = lastOpened[a.id];
      const bOpened = lastOpened[b.id];
      if (aOpened && bOpened) return bOpened.localeCompare(aOpened);
      if (aOpened) return -1;
      if (bOpened) return 1;
      return a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, search, auth, activeCompanyId, showArchived]);

  const hasArchivedCompanies = companies.some((c) => c.isArchived);

  return (
    <>
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
            <div className="flex items-center gap-3">
              <Input
                className="max-w-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={intl.formatMessage({ id: "companies.searchPlaceholder" })}
                aria-label={intl.formatMessage({ id: "companies.searchPlaceholder" })}
              />
              {hasArchivedCompanies && (
                <Button variant="ghost" size="sm" onClick={() => setShowArchived((prev) => !prev)}>
                  {showArchived
                    ? intl.formatMessage({ id: "companies.hideArchived" })
                    : intl.formatMessage({ id: "companies.showArchived" })}
                </Button>
              )}
            </div>
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
              <div
                key={company.id}
                className={`flex flex-col gap-3 rounded-md border px-4 py-3 ${company.isArchived ? "opacity-60" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${company.isArchived ? "line-through" : ""}`}>{company.name}</span>
                    {company.id === activeCompanyId && <Badge>{intl.formatMessage({ id: "common.active" })}</Badge>}
                    {company.isArchived && (
                      <Badge variant="secondary">{intl.formatMessage({ id: "companies.archived" })}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => toggleExpanded(key)}>
                      {expanded.has(key)
                        ? intl.formatMessage({ id: "companies.hideMembers" })
                        : intl.formatMessage({ id: "companies.members" })}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={archiving === company.id}
                      onClick={() =>
                        setConfirmArchive({ id: company.id, name: company.name, isArchived: company.isArchived })
                      }
                    >
                      {company.isArchived
                        ? intl.formatMessage({ id: "companies.unarchive" })
                        : intl.formatMessage({ id: "companies.archive" })}
                    </Button>
                  </div>
                </div>
                {expanded.has(key) && <MembersPanel scope="company" scopeId={company.id} />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Archive/Unarchive confirmation dialog */}
      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 className="mb-2 text-lg font-semibold">
              {intl.formatMessage({
                id: confirmArchive.isArchived ? "companies.unarchiveConfirmTitle" : "companies.archiveConfirmTitle",
              })}
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              {intl.formatMessage(
                {
                  id: confirmArchive.isArchived
                    ? "companies.unarchiveConfirmMessage"
                    : "companies.archiveConfirmMessage",
                },
                { name: confirmArchive.name },
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmArchive(null)} disabled={archiving !== null}>
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
              <Button
                variant={confirmArchive.isArchived ? "default" : "destructive"}
                disabled={archiving !== null}
                onClick={() => handleArchiveToggle(confirmArchive.id, confirmArchive.name, confirmArchive.isArchived)}
              >
                {archiving !== null
                  ? "..."
                  : intl.formatMessage({
                      id: confirmArchive.isArchived ? "companies.unarchive" : "companies.archive",
                    })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
