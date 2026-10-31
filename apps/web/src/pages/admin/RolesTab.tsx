import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { CompanyRoleResponse, ModuleAccessResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccessLevel, PartnerScope } from "@/lib/hr-enums";
import { cn } from "@/lib/utils";
import { ACCESS_AREAS, ACCESS_LEVELS, areaLabel, emptyLevels, levelLabel, pagesFor, type AccessArea } from "@/pages/admin/accessAreas";

interface Draft {
  id: string | null;
  name: string;
  description: string;
  levels: ModuleAccessResponse;
  partnerScope: number;
}

const toDraft = (role: CompanyRoleResponse | null, copy = false): Draft =>
  role
    ? {
        id: copy ? null : role.id,
        name: copy ? `${role.name} (2)` : role.name,
        description: role.description ?? "",
        levels: { ...role.levels },
        partnerScope: role.partnerScope,
      }
    : { id: null, name: "", description: "", levels: emptyLevels(), partnerScope: PartnerScope.All };

// docs/USER_ACCESS_PLAN.md: named roles — one level per area (None / View / Edit / Approve) and a
// partner scope — like QuickBooks Advanced custom roles and Odoo's app groups.
export function RolesTab({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryKey = ["admin", "roles", companyId] as const;

  const rolesQuery = useQuery({ queryKey, queryFn: () => apiClient.listCompanyRoles(companyId) });
  const roles = rolesQuery.data ?? [];
  const selected = draft?.id ? roles.find((r) => r.id === draft.id) ?? null : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["admin", "users", companyId] });
  };

  const saveMutation = useMutation({
    mutationFn: (d: Draft) => {
      const body = { name: d.name.trim(), description: d.description.trim() || undefined, levels: d.levels, partnerScope: d.partnerScope };
      return d.id ? apiClient.updateCompanyRole(companyId, d.id, body) : apiClient.createCompanyRole(companyId, body);
    },
    onSuccess: (saved) => {
      setError(null);
      setDraft(toDraft(saved));
      refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "admin.roles.saveError" }))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteCompanyRole(companyId, id),
    onSuccess: () => {
      setDraft(null);
      refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "admin.roles.deleteError" }))),
  });

  function setLevel(area: AccessArea, level: number) {
    setDraft((d) => (d ? { ...d, levels: { ...d.levels, [area]: level } } : d));
  }

  const pages = draft ? pagesFor(draft.levels) : [];
  const ledgerBlocked = draft?.partnerScope === PartnerScope.Assigned && (draft.levels.accounting ?? 0) > AccessLevel.None;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{intl.formatMessage({ id: "admin.roles.title" })}</CardTitle>
          {canManage && (
            <Button size="xs" variant="outline" onClick={() => setDraft(toDraft(null))}>
              <Plus className="size-3.5" />
              {intl.formatMessage({ id: "admin.roles.new" })}
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <div className="rounded-md border px-3 py-2 text-sm">
            <div className="font-medium">{intl.formatMessage({ id: "admin.access.Administrator" })}</div>
            <div className="text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.roles.administratorHint" })}</div>
          </div>
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => {
                setError(null);
                setDraft(toDraft(role));
              }}
              className={cn(
                "flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50",
                draft?.id === role.id && "border-primary bg-muted/50",
              )}
            >
              <span className="font-medium">{role.name}</span>
              <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.roles.userCount" }, { count: role.userCount })}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {draft.id ? draft.name || "—" : intl.formatMessage({ id: "admin.roles.new" })}
              {selected?.builtInKey && <Badge variant="outline">{intl.formatMessage({ id: "admin.roles.builtIn" })}</Badge>}
            </CardTitle>
            <CardDescription>{intl.formatMessage({ id: "admin.roles.editorHint" })}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <fieldset disabled={!canManage} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="role-name">{intl.formatMessage({ id: "admin.roles.name" })}</Label>
                  <Input id="role-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="role-description">{intl.formatMessage({ id: "admin.roles.description" })}</Label>
                  <Input id="role-description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm" aria-label={intl.formatMessage({ id: "admin.roles.matrix" })}>
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">{intl.formatMessage({ id: "admin.roles.area" })}</th>
                      {ACCESS_LEVELS.map((level) => (
                        <th key={level} className="px-2 py-1.5 text-center font-medium">
                          {levelLabel(level, intl)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ACCESS_AREAS.map((area) => (
                      <tr key={area} className="border-t">
                        <td className="px-3 py-1">
                          <div className="font-medium">{areaLabel(area, intl)}</div>
                          <div className="text-xs text-muted-foreground">{intl.formatMessage({ id: `admin.area.${area}.hint` })}</div>
                        </td>
                        {ACCESS_LEVELS.map((level) => (
                          <td key={level} className="px-2 py-1 text-center">
                            <input
                              type="radio"
                              name={`level-${area}`}
                              aria-label={`${areaLabel(area, intl)}: ${levelLabel(level, intl)}`}
                              checked={(draft.levels[area] ?? 0) === level}
                              onChange={() => setLevel(area, level)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.roles.levelsHint" })}</p>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={draft.partnerScope === PartnerScope.Assigned}
                  onChange={(e) => setDraft({ ...draft, partnerScope: e.target.checked ? PartnerScope.Assigned : PartnerScope.All })}
                />
                <span>
                  {intl.formatMessage({ id: "admin.roles.assignedOnly" })}
                  <span className="block text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.roles.assignedOnlyHint" })}</span>
                </span>
              </label>
              {ledgerBlocked && (
                <Alert>
                  <AlertDescription>{intl.formatMessage({ id: "admin.roles.ledgerBlocked" })}</AlertDescription>
                </Alert>
              )}
            </fieldset>

            <div className="rounded-md bg-muted/40 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{intl.formatMessage({ id: "admin.roles.preview" })}</p>
              {pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "admin.roles.previewNone" })}</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {pages.map((page) => (
                    <Badge key={page.titleKey} variant={page.level >= AccessLevel.Write ? "default" : "outline"}>
                      {intl.formatMessage({ id: page.titleKey })} · {levelLabel(page.level, intl)}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.roles.previewSelf" })}</p>
            </div>

            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={saveMutation.isPending || !draft.name.trim()} onClick={() => saveMutation.mutate(draft)}>
                  {intl.formatMessage({ id: "common.save" })}
                </Button>
                {selected && (
                  <Button variant="outline" onClick={() => setDraft(toDraft(selected, true))}>
                    <Copy className="size-4" />
                    {intl.formatMessage({ id: "admin.roles.duplicate" })}
                  </Button>
                )}
                {selected && (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (window.confirm(intl.formatMessage({ id: "admin.roles.deleteConfirm" }, { name: selected.name }))) deleteMutation.mutate(selected.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                    {intl.formatMessage({ id: "common.delete" })}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{intl.formatMessage({ id: "admin.roles.pick" })}</CardContent>
        </Card>
      )}
    </div>
  );
}
