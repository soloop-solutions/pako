import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { FirmResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { CompanyList } from "@/pages/shared/CompanyList";
import { MembersPanel } from "@/pages/shared/MembersPanel";

export function Companies() {
  const intl = useIntl();
  const { createCompany } = useCompany();
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [firmId, setFirmId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [firms, setFirms] = useState<FirmResponse[]>([]);
  const [firmsLoading, setFirmsLoading] = useState(false);
  const [firmsError, setFirmsError] = useState<string | null>(null);
  const [firmDialogOpen, setFirmDialogOpen] = useState(false);
  const [newFirmName, setNewFirmName] = useState("");
  const [createFirmError, setCreateFirmError] = useState<string | null>(null);
  const [creatingFirm, setCreatingFirm] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refreshFirms = useCallback(async () => {
    setFirmsLoading(true);
    setFirmsError(null);
    try {
      const result = await apiClient.firmsAll();
      setFirms(result);
    } catch (err) {
      setFirmsError(getApiErrorMessage(err, intl.formatMessage({ id: "companies.loadFirmsError" })));
    } finally {
      setFirmsLoading(false);
    }
  }, [intl]);

  useEffect(() => {
    void refreshFirms();
  }, [refreshFirms]);

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

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await createCompany(name.trim(), firmId || undefined);
      setName("");
      setFirmId("");
      setCompanyDialogOpen(false);
    } catch (err) {
      setCreateError(getApiErrorMessage(err, intl.formatMessage({ id: "companies.createError" })));
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateFirm(event: FormEvent) {
    event.preventDefault();
    setCreateFirmError(null);
    setCreatingFirm(true);
    try {
      await apiClient.firms({ name: newFirmName.trim() });
      setNewFirmName("");
      setFirmDialogOpen(false);
      await refreshFirms();
    } catch (err) {
      setCreateFirmError(getApiErrorMessage(err, intl.formatMessage({ id: "companies.createFirmError" })));
    } finally {
      setCreatingFirm(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CompanyList />
        <Button onClick={() => { setCompanyDialogOpen(true); setCreateError(null); setName(""); setFirmId(""); }}>
          {intl.formatMessage({ id: "companies.createCompanyButton" })}
        </Button>
      </div>

      <FormDialog
        open={companyDialogOpen}
        onOpenChange={(open) => { if (!open) { setCompanyDialogOpen(false); setCreateError(null); } }}
        title={intl.formatMessage({ id: "companies.createCompany" })}
        description={intl.formatMessage({ id: "companies.createCompanyDescription" })}
        size="sm"
        dirty={name.trim().length > 0}
      >
        <form className="flex flex-col gap-4" onSubmit={handleCreate}>
          {createError && (
            <Alert variant="destructive">
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="company-name">{intl.formatMessage({ id: "companies.companyName" })}</Label>
            <Input id="company-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="company-firm">{intl.formatMessage({ id: "companies.firmOptional" })}</Label>
            <SearchableSelect
              id="company-firm"
              value={firmId}
              onChange={setFirmId}
              placeholder={intl.formatMessage({ id: "companies.directCompany" })}
              searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })}
              emptyOptionLabel={intl.formatMessage({ id: "companies.directCompany" })}
              options={firms.map((firm) => ({
                value: firm.id,
                label: firm.name,
              }))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setCompanyDialogOpen(false); setCreateError(null); }}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="submit" disabled={creating || name.trim().length === 0}>
              {creating
                ? intl.formatMessage({ id: "companies.creating" })
                : intl.formatMessage({ id: "companies.createCompanyButton" })}
            </Button>
          </div>
        </form>
      </FormDialog>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{intl.formatMessage({ id: "companies.firmsTitle" })}</CardTitle>
              <CardDescription>{intl.formatMessage({ id: "companies.firmsDescription" })}</CardDescription>
            </div>
            <Button variant="outline" onClick={() => { setFirmDialogOpen(true); setCreateFirmError(null); setNewFirmName(""); }}>
              {intl.formatMessage({ id: "companies.createFirmButton" })}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {firmsError && (
            <Alert variant="destructive">
              <AlertDescription>{firmsError}</AlertDescription>
            </Alert>
          )}
          {firmsLoading && firms.length === 0 && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "companies.loadingFirms" })}</p>}
          {!firmsLoading && firms.length === 0 && !firmsError && (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "companies.noFirms" })}</p>
          )}
          {firms.map((firm) => {
            const key = `firm:${firm.id}`;
            return (
              <div key={firm.id} className="flex flex-col gap-3 rounded-md border px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{firm.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => toggleExpanded(key)}>
                    {expanded.has(key)
                      ? intl.formatMessage({ id: "companies.hideMembers" })
                      : intl.formatMessage({ id: "companies.members" })}
                  </Button>
                </div>
                {expanded.has(key) && <MembersPanel scope="firm" scopeId={firm.id} />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <FormDialog
        open={firmDialogOpen}
        onOpenChange={(open) => { if (!open) { setFirmDialogOpen(false); setCreateFirmError(null); } }}
        title={intl.formatMessage({ id: "companies.createFirmButton" })}
        size="sm"
        dirty={newFirmName.trim().length > 0}
      >
        <form className="flex flex-col gap-4" onSubmit={handleCreateFirm}>
          {createFirmError && (
            <Alert variant="destructive">
              <AlertDescription>{createFirmError}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="firm-name">{intl.formatMessage({ id: "companies.firmName" })}</Label>
            <Input id="firm-name" required value={newFirmName} onChange={(event) => setNewFirmName(event.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setFirmDialogOpen(false); setCreateFirmError(null); }}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="submit" disabled={creatingFirm || newFirmName.trim().length === 0}>
              {creatingFirm
                ? intl.formatMessage({ id: "companies.creating" })
                : intl.formatMessage({ id: "companies.createFirmButton" })}
            </Button>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
