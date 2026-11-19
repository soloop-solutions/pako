import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { AssetCategoryResponse, SaveAssetCategoryRequest } from "@pako/shared";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

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
import { useMyAccess } from "@/hooks/useMyAccess";
import { accountOptions, usePostableAccounts } from "@/pages/assets/shared";

// Asset categories and their three accounts. "Add standard categories" creates the usual Kosovo
// ones from the chart of accounts (the API skips any whose accounts are missing or already used).
export function AssetCategoriesTab({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const queryClient = useQueryClient();
  const { canWrite } = useMyAccess();
  const readOnly = !canWrite("accounting");
  const [editing, setEditing] = useState<AssetCategoryResponse | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["assetCategories", companyId], queryFn: () => apiClient.listAssetCategories(companyId) });
  const categories = useMemo(() => query.data ?? [], [query.data]);

  const save = useMutation({
    mutationFn: (vars: { id: string | null; request: SaveAssetCategoryRequest }) =>
      vars.id ? apiClient.updateAssetCategory(companyId, vars.id, vars.request) : apiClient.createAssetCategory(companyId, vars.request),
    onSuccess: async () => {
      toast.success(t("assets.categorySaved"));
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["assetCategories", companyId] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("assets.saveError"))),
  });

  const defaults = useMutation({
    mutationFn: () => apiClient.createDefaultAssetCategories(companyId),
    onSuccess: async (list) => {
      toast.success(intl.formatMessage({ id: "assets.defaultsCreated" }, { count: list.length }));
      await queryClient.invalidateQueries({ queryKey: ["assetCategories", companyId] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("assets.saveError"))),
  });

  const columns = useMemo<ColumnDef<AssetCategoryResponse>[]>(
    () => [
      { accessorKey: "name", header: t("common.name") },
      { accessorKey: "assetAccountCode", header: t("assets.assetAccount") },
      { id: "accumulated", accessorFn: (c) => c.accumulatedDepreciationAccountCode ?? "—", header: t("assets.accumulatedAccount") },
      { id: "expense", accessorFn: (c) => c.depreciationExpenseAccountCode ?? "—", header: t("assets.expenseAccount") },
      {
        id: "life",
        accessorFn: (c) => (c.isDepreciable ? c.defaultUsefulLifeMonths : 0),
        header: t("assets.usefulLifeMonths"),
        meta: { numeric: true },
        cell: ({ row }) => (row.original.isDepreciable ? row.original.defaultUsefulLifeMonths : t("assets.status.notDepreciated")),
      },
      { accessorKey: "assetCount", header: t("assets.col.assetCount"), meta: { numeric: true } },
      {
        accessorKey: "isActive",
        header: t("assets.col.status"),
        cell: ({ getValue }) => (getValue() ? <Badge variant="default">{t("common.active")}</Badge> : <Badge variant="secondary">{t("assets.inactive")}</Badge>),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-4">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => { setEditing("new"); setError(null); }}>{t("assets.newCategory")}</Button>
          <Button size="sm" variant={categories.length === 0 ? "default" : "outline"} disabled={defaults.isPending} onClick={() => defaults.mutate()}>
            {t("assets.addDefaults")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("assets.addDefaultsHint")}</p>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {editing && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>{editing === "new" ? t("assets.newCategory") : intl.formatMessage({ id: "assets.editCategory" }, { name: editing.name })}</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryForm
              key={editing === "new" ? "new" : editing.id}
              companyId={companyId}
              initial={editing === "new" ? null : editing}
              submitting={save.isPending}
              onSubmit={(request) => { setError(null); save.mutate({ id: editing === "new" ? null : editing.id, request }); }}
              onCancel={() => setEditing(null)}
            />
          </CardContent>
        </Card>
      )}

      <DataGrid
        gridId="assetCategories"
        columns={columns}
        data={categories}
        rowCount={categories.length}
        isLoading={query.isPending}
        getRowId={(c) => c.id}
        getRowClassName={(c) => (c.isActive ? undefined : "text-muted-foreground")}
        onRowClick={readOnly ? undefined : (c) => { setEditing(c); setError(null); }}
        emptyMessage={t("assets.categoriesEmpty")}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={200}
        pageSizeOptions={[200]}
      />
    </div>
  );
}

function CategoryForm({
  companyId,
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  companyId: string;
  initial: AssetCategoryResponse | null;
  submitting: boolean;
  onSubmit: (request: SaveAssetCategoryRequest) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const accounts = usePostableAccounts(companyId).data;
  const [name, setName] = useState(initial?.name ?? "");
  const [assetAccountId, setAssetAccountId] = useState(initial?.assetAccountId ?? "");
  const [depreciable, setDepreciable] = useState(initial?.isDepreciable ?? true);
  const [accumulatedId, setAccumulatedId] = useState(initial?.accumulatedDepreciationAccountId ?? "");
  const [expenseId, setExpenseId] = useState(initial?.depreciationExpenseAccountId ?? "");
  const [life, setLife] = useState(initial?.isDepreciable ? String(initial.defaultUsefulLifeMonths) : "60");
  const [active, setActive] = useState(initial?.isActive ?? true);
  const locked = (initial?.assetCount ?? 0) > 0;

  const common = { searchPlaceholder: t("common.search"), noResultsText: t("common.noResults"), placeholder: t("assets.chooseAccount") };

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name: name.trim(),
      assetAccountId,
      isDepreciable: depreciable,
      accumulatedDepreciationAccountId: depreciable ? accumulatedId || undefined : undefined,
      depreciationExpenseAccountId: depreciable ? expenseId || undefined : undefined,
      defaultUsefulLifeMonths: depreciable ? parseInt(life, 10) || 0 : 0,
      isActive: active,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {locked && <p className="text-sm text-muted-foreground">{t("assets.categoryInUseHint")}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label={t("common.name")} htmlFor="asset-category-name" required>
          <Input id="asset-category-name" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={t("assets.assetAccount")} htmlFor="asset-category-asset" required>
          <SearchableSelect id="asset-category-asset" value={assetAccountId} onChange={setAssetAccountId} options={accountOptions(accounts, ["15"], ["159"])} {...common} />
        </FormField>
        {depreciable && (
          <FormField label={t("assets.usefulLifeMonths")} htmlFor="asset-category-life" required>
            <Input id="asset-category-life" type="number" min="1" max="1200" step="1" required value={life} onChange={(e) => setLife(e.target.value)} />
          </FormField>
        )}
        {depreciable && (
          <FormField label={t("assets.accumulatedAccount")} htmlFor="asset-category-accumulated" required>
            <SearchableSelect id="asset-category-accumulated" value={accumulatedId} onChange={setAccumulatedId} options={accountOptions(accounts, ["159", "158"])} {...common} />
          </FormField>
        )}
        {depreciable && (
          <FormField label={t("assets.expenseAccount")} htmlFor="asset-category-expense" required>
            <SearchableSelect id="asset-category-expense" value={expenseId} onChange={setExpenseId} options={accountOptions(accounts, ["65"])} {...common} />
          </FormField>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={depreciable} onChange={(e) => setDepreciable(e.target.checked)} />
          {t("assets.isDepreciable")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("common.active")}
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || !assetAccountId}>{t("common.save")}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
