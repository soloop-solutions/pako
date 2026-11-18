import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { DiscountRuleResponse, SaveDiscountRuleRequest } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompany } from "@/context/CompanyContext";
import { useConfirm } from "@/components/ui/confirm-context";
import { useItemLookup } from "@/hooks/useItemLookup";
import { useMyAccess } from "@/hooks/useMyAccess";
import { formatDisplayDate } from "@/lib/dates";

const GRID_ID = "discountRules";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Client feedback 2026-11: a discount % (rabat) for a period, for a customer, an item category, an
// item or a combination. Invoices and sales orders dated inside the period start their lines with it;
// the most specific rule wins and rules never stack (the API decides, DiscountRuleMatcher).
export function DiscountRules() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const readOnly = !canWrite("sales");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeOnly = searchParams.get("active") === "1";

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const queryKey = ["discountRules", activeCompanyId, activeOnly] as const;
  const rulesQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.listDiscountRules(activeCompanyId as string, activeOnly ? today() : undefined),
    enabled: !!activeCompanyId,
  });
  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);
  const editing = editingId ? (rules.find((r) => r.id === editingId) ?? null) : null;

  function closeForms() {
    setFormOpen(false);
    setEditingId(null);
    setMutationError(null);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["discountRules", activeCompanyId] });
  }

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string | null; request: SaveDiscountRuleRequest }) =>
      vars.id
        ? apiClient.updateDiscountRule(activeCompanyId as string, vars.id, vars.request)
        : apiClient.createDiscountRule(activeCompanyId as string, vars.request),
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "discountRules.saved" }));
      closeForms();
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "discountRules.saveError" }))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteDiscountRule(activeCompanyId as string, id),
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "discountRules.deleted" }));
      closeForms();
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "discountRules.saveError" }))),
  });

  function remove(rule: DiscountRuleResponse) {
    confirm(
      intl.formatMessage({ id: "discountRules.deleteDescription" }, { name: rule.name }),
      () => deleteMutation.mutate(rule.id),
      { confirmLabel: intl.formatMessage({ id: "common.delete" }), destructive: true },
    );
  }

  const all = intl.formatMessage({ id: "discountRules.anyTarget" });
  const columns = useMemo<ColumnDef<DiscountRuleResponse>[]>(
    () => [
      { accessorKey: "name", header: intl.formatMessage({ id: "common.name" }) },
      { id: "partner", accessorFn: (r) => r.partnerName ?? all, header: intl.formatMessage({ id: "discountRules.customer" }) },
      { id: "category", accessorFn: (r) => r.itemCategoryName ?? all, header: intl.formatMessage({ id: "discountRules.category" }) },
      { id: "item", accessorFn: (r) => r.itemName ?? all, header: intl.formatMessage({ id: "discountRules.item" }) },
      {
        accessorKey: "percent",
        header: intl.formatMessage({ id: "discountRules.percent" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        cell: ({ getValue }) => `${(getValue() as number).toFixed(2)}%`,
      },
      {
        id: "period",
        accessorFn: (r) => `${r.validFrom} ${r.validTo}`,
        header: intl.formatMessage({ id: "discountRules.period" }),
        enableColumnFilter: false,
        cell: ({ row }) => `${formatDisplayDate(row.original.validFrom)} – ${formatDisplayDate(row.original.validTo)}`,
      },
      {
        id: "status",
        accessorFn: (r) => (r.isActive ? 1 : 0),
        header: intl.formatMessage({ id: "discountRules.status" }),
        enableColumnFilter: false,
        cell: ({ row }) => {
          const r = row.original;
          const expired = r.validTo < today();
          if (!r.isActive) return <Badge variant="secondary">{intl.formatMessage({ id: "discountRules.inactive" })}</Badge>;
          if (expired) return <Badge variant="outline" className="text-muted-foreground line-through">{intl.formatMessage({ id: "discountRules.expired" })}</Badge>;
          return <Badge variant="default">{intl.formatMessage({ id: "discountRules.active" })}</Badge>;
        },
      },
    ],
    [intl, all],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = rulesQuery.isError ? getApiErrorMessage(rulesQuery.error, intl.formatMessage({ id: "discountRules.loadError" })) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "nav.discountRules" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "nav.discountRules.description" })}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={activeOnly}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                if (e.target.checked) next.set("active", "1");
                else next.delete("active");
                setSearchParams(next, { replace: true });
              }}
            />
            {intl.formatMessage({ id: "discountRules.activeToday" })}
          </label>
          {!readOnly && (
            <Button
              onClick={() => {
                setFormOpen((open) => !open);
                setEditingId(null);
                setMutationError(null);
              }}
            >
              {intl.formatMessage({ id: "discountRules.new" })}
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {((formOpen && !editing) || editing) && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editing ? intl.formatMessage({ id: "discountRules.edit" }, { name: editing.name }) : intl.formatMessage({ id: "discountRules.new" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DiscountRuleForm
              key={editing?.id ?? "new"}
              companyId={activeCompanyId}
              initial={editing}
              submitting={saveMutation.isPending || deleteMutation.isPending}
              error={mutationError}
              onSubmit={(request) => saveMutation.mutate({ id: editing?.id ?? null, request })}
              onDelete={editing ? () => remove(editing) : undefined}
              onCancel={closeForms}
            />
          </CardContent>
        </Card>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={rules}
        rowCount={rules.length}
        isLoading={rulesQuery.isPending}
        getRowId={(row) => row.id}
        getRowClassName={(row) => (!row.isActive || row.validTo < today() ? "text-muted-foreground" : undefined)}
        onRowClick={
          readOnly
            ? undefined
            : (row) => {
                setEditingId(row.id);
                setFormOpen(false);
                setMutationError(null);
              }
        }
        enableGlobalFilter
        emptyMessage={intl.formatMessage({ id: "discountRules.empty" })}
        exportFileName="discount-rules"
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={100}
        pageSizeOptions={[50, 100, 200]}
      />
    </div>
  );
}

function DiscountRuleForm({
  companyId,
  initial,
  submitting,
  error,
  onSubmit,
  onDelete,
  onCancel,
}: {
  companyId: string;
  initial: DiscountRuleResponse | null;
  submitting: boolean;
  error: string | null;
  onSubmit: (request: SaveDiscountRuleRequest) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const [name, setName] = useState(initial?.name ?? "");
  const [percent, setPercent] = useState(initial ? String(initial.percent) : "");
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? today());
  const [validTo, setValidTo] = useState(initial?.validTo ?? today());
  const [partnerId, setPartnerId] = useState(initial?.partnerId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.itemCategoryId ?? "");
  const [itemId, setItemId] = useState(initial?.itemId ?? "");
  const [priority, setPriority] = useState(initial ? String(initial.priority) : "0");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [targetError, setTargetError] = useState<string | null>(null);

  const partners = useQuery({
    queryKey: ["partners", companyId, "all"],
    queryFn: () => apiClient.partnersAll(companyId),
  }).data;
  const categories = useQuery({
    queryKey: ["itemCategories", companyId],
    queryFn: () => apiClient.listItemCategories(companyId),
  }).data;
  const lookup = useItemLookup([itemId]);
  const itemOptions = useMemo(() => {
    const options = lookup.search.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
    if (itemId && !options.some((o) => o.value === itemId)) {
      options.push({ value: itemId, label: lookup.find(itemId)?.name ?? initial?.itemName ?? itemId });
    }
    return options;
  }, [lookup, itemId, initial?.itemName]);

  const anyLabel = intl.formatMessage({ id: "discountRules.anyTarget" });
  const common = {
    searchPlaceholder: intl.formatMessage({ id: "common.search" }),
    noResultsText: intl.formatMessage({ id: "common.noResults" }),
    placeholder: anyLabel,
    emptyOptionLabel: anyLabel,
  };

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!partnerId && !categoryId && !itemId) {
      setTargetError(intl.formatMessage({ id: "discountRules.targetRequired" }));
      return;
    }
    setTargetError(null);
    onSubmit({
      name: name.trim(),
      percent: parseFloat(percent) || 0,
      validFrom,
      validTo,
      partnerId: partnerId || undefined,
      itemCategoryId: categoryId || undefined,
      itemId: itemId || undefined,
      priority: parseInt(priority, 10) || 0,
      isActive,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {(error || targetError) && (
        <Alert variant="destructive">
          <AlertDescription>{targetError ?? error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FormField label={intl.formatMessage({ id: "common.name" })} htmlFor="discount-rule-name" required className="sm:col-span-2">
          <Input id="discount-rule-name" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={intl.formatMessage({ id: "discountRules.percent" })} htmlFor="discount-rule-percent" required>
          <Input id="discount-rule-percent" required type="number" min="0.01" max="100" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </FormField>
        <FormField label={intl.formatMessage({ id: "discountRules.priority" })} htmlFor="discount-rule-priority" hint={intl.formatMessage({ id: "discountRules.priorityHint" })}>
          <Input id="discount-rule-priority" type="number" step="1" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </FormField>
        <FormField label={intl.formatMessage({ id: "discountRules.validFrom" })} htmlFor="discount-rule-from" required>
          <Input id="discount-rule-from" type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </FormField>
        <FormField label={intl.formatMessage({ id: "discountRules.validTo" })} htmlFor="discount-rule-to" required>
          <Input id="discount-rule-to" type="date" required value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </FormField>
      </div>
      <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "discountRules.targetsHint" })}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label={intl.formatMessage({ id: "discountRules.customer" })} htmlFor="discount-rule-partner">
          <SearchableSelect
            id="discount-rule-partner"
            value={partnerId}
            onChange={setPartnerId}
            options={(partners ?? []).filter((p) => p.isCustomer || p.id === partnerId).map((p) => ({ value: p.id, label: p.name }))}
            {...common}
          />
        </FormField>
        <FormField label={intl.formatMessage({ id: "discountRules.category" })} htmlFor="discount-rule-category">
          <SearchableSelect
            id="discount-rule-category"
            value={categoryId}
            onChange={setCategoryId}
            options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
            {...common}
          />
        </FormField>
        <FormField label={intl.formatMessage({ id: "discountRules.item" })} htmlFor="discount-rule-item">
          <SearchableSelect
            id="discount-rule-item"
            value={itemId}
            onChange={setItemId}
            options={itemOptions}
            onSearchChange={lookup.search.onSearchChange}
            {...common}
          />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {intl.formatMessage({ id: "discountRules.active" })}
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {intl.formatMessage({ id: "common.save" })}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
        {onDelete && (
          <Button type="button" variant="ghost" className="ml-auto text-destructive" onClick={onDelete} disabled={submitting}>
            {intl.formatMessage({ id: "common.delete" })}
          </Button>
        )}
      </div>
    </form>
  );
}
