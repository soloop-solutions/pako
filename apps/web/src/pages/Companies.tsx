import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { FirmResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { MembersPanel } from "@/pages/shared/MembersPanel";

export function Companies() {
  const { companies, activeCompanyId, loading, error, setActiveCompanyId, createCompany } = useCompany();
  const [name, setName] = useState("");
  const [firmId, setFirmId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [firms, setFirms] = useState<FirmResponse[]>([]);
  const [firmsLoading, setFirmsLoading] = useState(false);
  const [firmsError, setFirmsError] = useState<string | null>(null);
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
      setFirmsError(getApiErrorMessage(err, "Could not load firms."));
    } finally {
      setFirmsLoading(false);
    }
  }, []);

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
    } catch (err) {
      setCreateError(getApiErrorMessage(err, "Could not create company."));
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
      await refreshFirms();
    } catch (err) {
      setCreateFirmError(getApiErrorMessage(err, "Could not create firm."));
    } finally {
      setCreatingFirm(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>Switch between companies and manage firm-client access.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {loading && companies.length === 0 && (
            <p className="text-sm text-muted-foreground">Loading companies...</p>
          )}
          {!loading && companies.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">No companies yet. Create one below.</p>
          )}
          {companies.map((company) => {
            const key = `company:${company.id}`;
            return (
              <div key={company.id} className="flex flex-col gap-3 rounded-md border px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{company.name}</span>
                    {company.id === activeCompanyId && <Badge>Active</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => toggleExpanded(key)}>
                      {expanded.has(key) ? "Hide members" : "Members"}
                    </Button>
                    <Button
                      variant={company.id === activeCompanyId ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setActiveCompanyId(company.id)}
                      disabled={company.id === activeCompanyId}
                    >
                      {company.id === activeCompanyId ? "Active" : "Set active"}
                    </Button>
                  </div>
                </div>
                {expanded.has(key) && <MembersPanel scope="company" scopeId={company.id} />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create a company</CardTitle>
          <CardDescription>Seeds a Kosovo chart of accounts and a default "General" journal.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleCreate}>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="company-name">Company name</Label>
              <Input id="company-name" required value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="company-firm">Firm (optional)</Label>
              <Select id="company-firm" value={firmId} onChange={(event) => setFirmId(event.target.value)}>
                <option value="">Direct company (no firm)</option>
                {firms.map((firm) => (
                  <option key={firm.id} value={firm.id}>
                    {firm.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={creating || name.trim().length === 0}>
              {creating ? "Creating..." : "Create company"}
            </Button>
          </form>
          {createError && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firms</CardTitle>
          <CardDescription>Accounting firms managing companies on your behalf, or that you manage.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {firmsError && (
            <Alert variant="destructive">
              <AlertDescription>{firmsError}</AlertDescription>
            </Alert>
          )}
          {firmsLoading && firms.length === 0 && <p className="text-sm text-muted-foreground">Loading firms...</p>}
          {!firmsLoading && firms.length === 0 && !firmsError && (
            <p className="text-sm text-muted-foreground">No firms yet. Create one below.</p>
          )}
          {firms.map((firm) => {
            const key = `firm:${firm.id}`;
            return (
              <div key={firm.id} className="flex flex-col gap-3 rounded-md border px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{firm.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => toggleExpanded(key)}>
                    {expanded.has(key) ? "Hide members" : "Members"}
                  </Button>
                </div>
                {expanded.has(key) && <MembersPanel scope="firm" scopeId={firm.id} />}
              </div>
            );
          })}

          <form className="flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-end" onSubmit={handleCreateFirm}>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="firm-name">Firm name</Label>
              <Input id="firm-name" required value={newFirmName} onChange={(event) => setNewFirmName(event.target.value)} />
            </div>
            <Button type="submit" disabled={creatingFirm || newFirmName.trim().length === 0}>
              {creatingFirm ? "Creating..." : "Create firm"}
            </Button>
          </form>
          {createFirmError && (
            <Alert variant="destructive">
              <AlertDescription>{createFirmError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
