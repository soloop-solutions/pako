import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { AccountResponse, ItemCategoryResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";

// docs/INVENTORY_PLAN.md D9 — product categories carry the accounts their items post to: stock,
// cost of goods sold, revenue and (for items without stock) expense. An item's own account wins.
export function ItemCategories() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ItemCategoryResponse | "new" | null>(null);
  const categoriesQuery = useQuery({
    queryKey: ["itemCategories", activeCompanyId],
    queryFn: () => apiClient.listItemCategories(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const accounts = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => apiClient.accountsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? [];
  const accountLabel = (id: string | undefined) => {
    const a = id ? accounts.find((x) => x.id === id) : undefined;
    return a ? `${a.code} ${a.name}` : t("stock.cat.fromDefault");
  };

  const columns = useMemo<ColumnDef<ItemCategoryResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("stock.cat.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("stock.wh.closed")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "inventoryAccountId", header: t("stock.cat.inventoryAccount"), cell: ({ getValue }) => accountLabel(getValue() as string | undefined) },
      { accessorKey: "cogsAccountId", header: t("stock.cat.cogsAccount"), cell: ({ getValue }) => accountLabel(getValue() as string | undefined) },
      { accessorKey: "revenueAccountId", header: t("stock.cat.revenueAccount"), cell: ({ getValue }) => accountLabel(getValue() as string | undefined) },
      { accessorKey: "itemCount", header: t("stock.cat.items"), meta: { numeric: true } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, accounts],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const categories = categoriesQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("nav.itemCategories")}</CardTitle>
          <CardDescription>{t("nav.itemCategories.description")}</CardDescription>
        </div>
        {canWrite("items") && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("stock.cat.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataGrid
          gridId="item-categories"
          columns={columns}
          data={categories}
          rowCount={categories.length}
          isLoading={categoriesQuery.isPending}
          getRowId={(c) => c.id}
          onRowClick={canWrite("items") ? setEditing : undefined}
          emptyMessage={t("stock.cat.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
      {editing && (
        <CategoryDialog
          category={editing === "new" ? null : editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["itemCategories", activeCompanyId] });
          }}
        />
      )}
    </Card>
  );
}

function CategoryDialog({ category, accounts, onClose, onSaved }: {
  category: ItemCategoryResponse | null; accounts: AccountResponse[]; onClose: () => void; onSaved: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [name, setName] = useState(category?.name ?? "");
  const [inventory, setInventory] = useState(category?.inventoryAccountId ?? "");
  const [cogs, setCogs] = useState(category?.cogsAccountId ?? "");
  const [revenue, setRevenue] = useState(category?.revenueAccountId ?? "");
  const [expense, setExpense] = useState(category?.expenseAccountId ?? "");
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        inventoryAccountId: inventory || undefined,
        cogsAccountId: cogs || undefined,
        revenueAccountId: revenue || undefined,
        expenseAccountId: expense || undefined,
        isActive,
      };
      return category
        ? apiClient.updateItemCategory(activeCompanyId as string, category.id, body)
        : apiClient.createItemCategory(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.cat.saveError"))),
  });

  // Each field offers the accounts of the right class: stock in class 1, cost of sales in class 5,
  // revenue in class 4, expense in classes 5–6.
  const options = (classes: number[]) =>
    accounts.filter((a) => a.isActive && a.isPostable && classes.includes(a.class ?? Number(a.code.charAt(0)))).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const field = (id: string, labelId: string, value: string, set: (v: string) => void, classes: number[]) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{t(labelId)}</Label>
      <SearchableSelect id={id} value={value} onChange={set} options={options(classes)} emptyOptionLabel={t("stock.cat.fromDefault")} placeholder={t("stock.cat.fromDefault")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")} />
    </div>
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={category ? category.name : t("stock.cat.new")} description={t("stock.cat.hint")} size="md">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="cat-name">{t("stock.cat.name")}</Label>
          <Input id="cat-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("cat-inventory", "stock.cat.inventoryAccount", inventory, setInventory, [1])}
          {field("cat-cogs", "stock.cat.cogsAccount", cogs, setCogs, [5])}
          {field("cat-revenue", "stock.cat.revenueAccount", revenue, setRevenue, [4])}
          {field("cat-expense", "stock.cat.expenseAccount", expense, setExpense, [5, 6])}
        </div>
        {category && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("stock.wh.active")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
