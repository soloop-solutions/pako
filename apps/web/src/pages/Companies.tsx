import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { FirmResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/shared/FormDialog";
import { CompanyList } from "@/pages/shared/CompanyList";
import { MembersPanel } from "@/pages/shared/MembersPanel";

export function Companies() {
  const intl = useIntl();

  const [firms, setFirms] = useState<FirmResponse[]>([]);
  const [firmsLoading, setFirmsLoading] = useState(false);
  const [firmsError, setFirmsError] = useState<string | null>(null);
  const [firmDialogOpen, setFirmDialogOpen] = useState(false);
  const [newFirmName, setNewFirmName] = useState("");
  const [createFirmError, setCreateFirmError] = useState<string | null>(null);
  const [firmNameError, setFirmNameError] = useState<string | null>(null);
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

  async function handleCreateFirm(event: FormEvent) {
    event.preventDefault();
    setCreateFirmError(null);
    if (!newFirmName.trim()) {
      setFirmNameError(intl.formatMessage({ id: "validation.required" }));
      return;
    }
    setFirmNameError(null);
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
      {/* New companies are created in the lobby, the only place the company changes. */}
      <CompanyList />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{intl.formatMessage({ id: "companies.firmsTitle" })}</CardTitle>
              <CardDescription>{intl.formatMessage({ id: "companies.firmsDescription" })}</CardDescription>
            </div>
            <Button variant="outline" onClick={() => { setFirmDialogOpen(true); setCreateFirmError(null); setFirmNameError(null); setNewFirmName(""); }}>
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
        onOpenChange={(open) => { if (!open) { setFirmDialogOpen(false); setCreateFirmError(null); setFirmNameError(null); } }}
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
          <FormField
            label={intl.formatMessage({ id: "companies.firmName" })}
            htmlFor="firm-name"
            error={firmNameError}
          >
            <Input
              id="firm-name"
              required
              value={newFirmName}
              aria-invalid={!!firmNameError}
              aria-describedby={firmNameError ? "firm-name-error" : undefined}
              onChange={(event) => { setNewFirmName(event.target.value); setFirmNameError(null); }}
            />
          </FormField>
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
