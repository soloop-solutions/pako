import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { DepartmentResponse, EmployeeDetailResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PartnerScope, partnerScopeLabel } from "@/lib/hr-enums";

/**
 * Which partners this employee is assigned to. The list only restricts what the employee sees when
 * their department's partner scope is "Assigned partners only"; otherwise it is informational.
 */
export function EmployeePartnerAccess({
  companyId,
  employee,
  department,
  readOnly,
}: {
  companyId: string;
  employee: EmployeeDetailResponse;
  department: DepartmentResponse | undefined;
  readOnly: boolean;
}) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // G11: the day the change takes effect — commission on a moved partner is split on it.
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const assignedQueryKey = ["employeePartners", companyId, employee.id] as const;
  const assignedQuery = useQuery({
    queryKey: assignedQueryKey,
    queryFn: () => apiClient.listEmployeePartners(companyId, employee.id),
  });
  const partnersQuery = useQuery({
    queryKey: ["partners", companyId],
    queryFn: () => apiClient.partnersAll(companyId),
  });

  const assignedIds = useMemo(() => new Set((assignedQuery.data ?? []).map((p) => p.partnerId)), [assignedQuery.data]);
  // null = untouched, so the checkboxes follow the saved assignments.
  const current = selected ?? assignedIds;
  const dirty = current.size !== assignedIds.size || [...current].some((id) => !assignedIds.has(id));

  const partners = useMemo(() => {
    const all = [...(partnersQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) => p.name.toLowerCase().includes(q) || (p.taxNumber ?? "").toLowerCase().includes(q));
  }, [partnersQuery.data, search]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.setEmployeePartners(companyId, employee.id, { partnerIds: [...current], effectiveFrom: effectiveFrom || undefined }),
    onSuccess: async (result) => {
      setError(null);
      setSaved(true);
      queryClient.setQueryData(assignedQueryKey, result);
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ["employee", companyId, employee.id] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "hr.partnerAccess.saveError" }))),
  });

  function toggle(id: string) {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev ?? assignedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const restricts = department?.partnerScope === PartnerScope.Assigned;
  const loadError = partnersQuery.isError || assignedQuery.isError;

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertDescription className="flex flex-col gap-1">
          <span>
            {department
              ? intl.formatMessage(
                  { id: "hr.partnerAccess.departmentScope" },
                  { department: department.name, scope: partnerScopeLabel(department.partnerScope, intl) },
                )
              : intl.formatMessage({ id: "hr.partnerAccess.noDepartment" })}
          </span>
          <span className="text-muted-foreground">
            {intl.formatMessage({ id: restricts ? "hr.partnerAccess.restricts" : "hr.partnerAccess.doesNotRestrict" })}
          </span>
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>
            {getApiErrorMessage(partnersQuery.error ?? assignedQuery.error, intl.formatMessage({ id: "hr.partnerAccess.loadError" }))}
          </AlertDescription>
        </Alert>
      )}
      {saved && !dirty && (
        <Alert>
          <AlertDescription>{intl.formatMessage({ id: "hr.partnerAccess.saved" })}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="h-8 w-64"
          placeholder={intl.formatMessage({ id: "hr.partnerAccess.searchPlaceholder" })}
          aria-label={intl.formatMessage({ id: "hr.partnerAccess.searchPlaceholder" })}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: "hr.partnerAccess.selectedCount" }, { count: current.size })}
        </span>
        {!readOnly && (
          <div className="ml-auto flex gap-2">
            {dirty && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                {intl.formatMessage({ id: "hr.partnerAccess.effectiveFrom" })}
                <input
                  type="date"
                  className="h-7 rounded-md border bg-transparent px-1 text-xs"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </label>
            )}
            {dirty && (
              <Button type="button" variant="outline" size="sm" onClick={() => setSelected(null)}>
                {intl.formatMessage({ id: "hr.employee.discardChanges" })}
              </Button>
            )}
            <Button type="button" size="sm" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? intl.formatMessage({ id: "common.saving" }) : intl.formatMessage({ id: "common.save" })}
            </Button>
          </div>
        )}
      </div>

      <div className="max-h-[480px] overflow-y-auto rounded-md border">
        {partnersQuery.isPending ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>
        ) : partners.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "common.noData" })}</p>
        ) : (
          partners.map((partner) => (
            <label
              key={partner.id}
              className="flex h-[30px] items-center gap-2 border-b px-3 text-[12.5px] last:border-b-0 hover:bg-row-hover"
            >
              <input type="checkbox" disabled={readOnly} checked={current.has(partner.id)} onChange={() => toggle(partner.id)} />
              <span className="min-w-0 flex-1 truncate">{partner.name}</span>
              {partner.taxNumber && <span className="text-[11px] text-muted-foreground tabular-nums">{partner.taxNumber}</span>}
              {partner.isCustomer && <Badge variant="secondary">{intl.formatMessage({ id: "partners.form.isCustomer" })}</Badge>}
              {partner.isVendor && <Badge variant="outline">{intl.formatMessage({ id: "partners.form.isVendor" })}</Badge>}
            </label>
          ))
        )}
      </div>
    </div>
  );
}
