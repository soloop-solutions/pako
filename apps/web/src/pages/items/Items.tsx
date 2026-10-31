import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { AccountType, isExpenseAccountType, isIncomeAccountType } from "@/lib/ledger-enums";
import { itemTypeLabel } from "@/lib/item-types";
import { useMyAccess } from "@/hooks/useMyAccess";
import { ItemForm, type ItemFormFields } from "@/pages/items/ItemForm";
import type { AccountResponse, ItemResponse, TaxDefinitionResponse } from "@pako/shared";

const ITEMS_GRID_ID = "items";

export function Items() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const urlState = useDataGridUrlState(ITEMS_GRID_ID, 50);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [barcodeItemId, setBarcodeItemId] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState("");
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  const itemsQueryKey = ["items", activeCompanyId, urlState.skip, urlState.take, urlState.globalFilter] as const;

  const itemsQuery = useQuery({
    queryKey: itemsQueryKey,
    queryFn: async () => {
      // B7: itemsGET is now page-based (1-indexed page, pageSize), not skip/take — convert.
      const page = Math.floor(urlState.skip / urlState.take) + 1;
      return apiClient.itemsGET(activeCompanyId as string, page, urlState.take, urlState.globalFilter || undefined, undefined);
    },
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const taxesQuery = useQuery({
    queryKey: ["taxes", activeCompanyId],
    queryFn: () => apiClient.taxes(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => apiClient.accountsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const taxes = useMemo<TaxDefinitionResponse[]>(() => taxesQuery.data ?? [], [taxesQuery.data]);
  const accounts = useMemo<AccountResponse[]>(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const { canSee } = useMyAccess();
  const showStock = canSee("inventory");
  const categoriesQuery = useQuery({
    queryKey: ["itemCategories", activeCompanyId],
    queryFn: () => apiClient.listItemCategories(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const categories = categoriesQuery.data ?? [];
  // B13: AccountType widened to Odoo's real 19 values — Income/Expense are each now a family of
  // types (e.g. Expense/OtherExpense/Depreciation/CostOfRevenue), not one bucket.
  const incomeAccounts = useMemo(() => accounts.filter((a) => isIncomeAccountType(a.accountType)), [accounts]);
  const expenseAccounts = useMemo(() => accounts.filter((a) => isExpenseAccountType(a.accountType)), [accounts]);
  // B6: the real third default account (inventory) — no dedicated "Inventory" AccountType exists
  // in the real 19-value set, so this matches the backend's own fallback classification for a
  // general Class-1/Group-12 asset (AccountTypeDerivation.DeriveAccountType's `(1, _) =>
  // CurrentAsset` case, which is what a company's inventory-holding account lands on).
  const inventoryAccounts = useMemo(() => accounts.filter((a) => a.accountType === AccountType.CurrentAsset), [accounts]);

  async function refreshItems() {
    await queryClient.invalidateQueries({ queryKey: ["items", activeCompanyId] });
  }

  const createMutation = useMutation({
    mutationFn: async (fields: ItemFormFields) => {
      if (!activeCompanyId) throw new Error("no active company");
      return apiClient.itemsPOST(activeCompanyId, {
        name: fields.name,
        unit: fields.unit,
        type: fields.type,
        defaultUnitPrice: fields.defaultUnitPrice,
        defaultTaxDefinitionId: fields.defaultTaxDefinitionId,
        defaultRevenueAccountId: fields.defaultRevenueAccountId,
        defaultExpenseAccountId: fields.defaultExpenseAccountId,
        defaultInventoryAccountId: fields.defaultInventoryAccountId,
        description: fields.description,
        categoryId: fields.categoryId,
        trackInventory: fields.trackInventory,
        minimumStock: fields.minimumStock,
      });
    },
    onSuccess: async () => {
      setCreateError(null);
      setDirty(false);
      setCreateOpen(false);
      setCreateFormKey((k) => k + 1);
      urlState.setPage(1);
      await refreshItems();
    },
    onError: (err: unknown) => setCreateError(getApiErrorMessage(err, intl.formatMessage({ id: "items.createError" }))),
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; fields: ItemFormFields }) => {
      if (!activeCompanyId) throw new Error("no active company");
      return apiClient.itemsPUT(activeCompanyId, vars.id, {
        name: vars.fields.name,
        unit: vars.fields.unit,
        type: vars.fields.type,
        defaultUnitPrice: vars.fields.defaultUnitPrice,
        defaultTaxDefinitionId: vars.fields.defaultTaxDefinitionId,
        defaultRevenueAccountId: vars.fields.defaultRevenueAccountId,
        defaultExpenseAccountId: vars.fields.defaultExpenseAccountId,
        defaultInventoryAccountId: vars.fields.defaultInventoryAccountId,
        description: vars.fields.description,
        categoryId: vars.fields.categoryId,
        trackInventory: vars.fields.trackInventory,
        minimumStock: vars.fields.minimumStock,
      });
    },
    onSuccess: async () => {
      setEditError(null);
      setDirty(false);
      setEditingId(null);
      await refreshItems();
    },
    onError: (err: unknown) => setEditError(getApiErrorMessage(err, intl.formatMessage({ id: "items.saveError" }))),
  });

  const handleAddBarcode = useCallback(
    async (itemId: string, barcode: string) => {
      if (!activeCompanyId || !barcode.trim()) return;
      setBarcodeError(null);
      try {
        await apiClient.barcodesPOST(activeCompanyId, itemId, { barcode: barcode.trim() });
        setNewBarcode("");
        setBarcodeItemId(null);
        await queryClient.invalidateQueries({ queryKey: ["items", activeCompanyId] });
      } catch (err) {
        setBarcodeError(getApiErrorMessage(err, intl.formatMessage({ id: "items.barcodeError" })));
      }
    },
    [activeCompanyId, queryClient, intl],
  );

  const handleRemoveBarcode = useCallback(
    async (itemId: string, barcodeId: string) => {
      if (!activeCompanyId) return;
      try {
        await apiClient.barcodesDELETE(activeCompanyId, itemId, barcodeId);
        await queryClient.invalidateQueries({ queryKey: ["items", activeCompanyId] });
      } catch {
        /* ignore */
      }
    },
    [activeCompanyId, queryClient],
  );

  const items = itemsQuery.data?.items ?? [];
  const total = itemsQuery.data?.total ?? 0;
  const editingItem = editingId ? items.find((i) => i.id === editingId) : undefined;

  const columns = useMemo<ColumnDef<ItemResponse>[]>(
    () => [
      {
        accessorKey: "code",
        header: intl.formatMessage({ id: "common.code" }),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const value = getValue();
          return typeof value === "number" ? value : "—";
        },
      },
      {
        accessorKey: "name",
        header: intl.formatMessage({ id: "items.name" }),
        cell: ({ getValue }) => {
          const value = getValue();
          return typeof value === "string" ? value : "";
        },
      },
      {
        id: "type",
        header: intl.formatMessage({ id: "items.form.type" }),
        accessorFn: (row) => itemTypeLabel(row.type, intl),
        enableSorting: false,
      },
      {
        accessorKey: "unit",
        header: intl.formatMessage({ id: "items.unit" }),
        enableSorting: false,
        cell: ({ getValue }) => {
          const value = getValue();
          return typeof value === "string" ? value : "";
        },
      },
      {
        accessorKey: "defaultUnitPrice",
        header: intl.formatMessage({ id: "items.defaultPrice" }),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const value = getValue();
          return typeof value === "number" ? `${value.toFixed(2)} €` : "—";
        },
      },
      {
        id: "vatCode",
        header: intl.formatMessage({ id: "items.form.vatCode" }),
        enableSorting: false,
        accessorFn: (row) => taxes.find((t) => t.id === row.defaultTaxDefinitionId)?.code ?? "—",
      },
      {
        id: "revenueAccount",
        header: intl.formatMessage({ id: "items.form.revenueAccount" }),
        enableSorting: false,
        accessorFn: (row) => accounts.find((a) => a.id === row.defaultRevenueAccountId)?.code ?? "—",
      },
      {
        id: "expenseAccount",
        header: intl.formatMessage({ id: "items.form.expenseAccount" }),
        enableSorting: false,
        accessorFn: (row) => accounts.find((a) => a.id === row.defaultExpenseAccountId)?.code ?? "—",
      },
      {
        id: "inventoryAccount",
        header: intl.formatMessage({ id: "items.form.inventoryAccount" }),
        enableSorting: false,
        accessorFn: (row) => accounts.find((a) => a.id === row.defaultInventoryAccountId)?.code ?? "—",
      },
      {
        id: "barcodes",
        header: intl.formatMessage({ id: "items.barcodes" }),
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex flex-wrap items-center gap-1">
              {item.barcodes?.map((b) => (
                <Badge
                  key={b.id}
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => handleRemoveBarcode(item.id, b.id)}
                >
                  {b.barcode} ×
                </Badge>
              ))}
              {barcodeItemId === item.id ? (
                <span className="flex items-center gap-1">
                  <Input
                    className="h-6 w-32 text-xs"
                    value={newBarcode}
                    onChange={(e) => setNewBarcode(e.target.value)}
                    placeholder="barcode..."
                  />
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleAddBarcode(item.id, newBarcode)}>
                    +
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setBarcodeItemId(null)}>
                    ×
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => {
                    setBarcodeItemId(item.id);
                    setNewBarcode("");
                  }}
                >
                  + {intl.formatMessage({ id: "items.addBarcode" })}
                </Button>
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            // Bug fix (code review): an edit already in progress must be finished or cancelled
            // before starting another — without this, clicking Edit on a second row while the
            // first row's form is still showing (unsaved) let the two get mixed up (see the `key`
            // prop below for the other half of this fix).
            onClick={() => {
              setEditingId(row.original.id);
              setCreateOpen(false);
              setEditError(null);
              setDirty(false);
            }}
          >
            {intl.formatMessage({ id: "common.edit" })}
          </Button>
        ),
      },
    ],
    [intl, barcodeItemId, newBarcode, handleAddBarcode, handleRemoveBarcode, taxes, accounts],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = itemsQuery.isError ? getApiErrorMessage(itemsQuery.error, intl.formatMessage({ id: "items.loadError" })) : null;

  // `ItemsController` caps take at 200 (a per-request page-size limit), not total item count —
  // a company can have more items than fit on one loaded page. Client-side filter/sort/group is
  // only safe when the currently-loaded page genuinely is the whole dataset; otherwise stay on
  // DataGrid's manual (server-driven) default so we don't silently re-hide/reorder rows that
  // exist elsewhere in the catalog.
  const isFullyLoaded = items.length === total;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "items.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "items.description" })}</p>
        </div>
        <Button onClick={() => { setCreateOpen(true); setEditingId(null); setCreateError(null); setDirty(false); }}>
          {intl.formatMessage({ id: "items.addItem" })}
        </Button>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {barcodeError && (
        <Alert variant="destructive">
          <AlertDescription>{barcodeError}</AlertDescription>
        </Alert>
      )}

      <FormDialog
        open={createOpen}
        onOpenChange={(open) => { if (!open) { setCreateOpen(false); setCreateError(null); setDirty(false); } }}
        title={intl.formatMessage({ id: "items.newItem" })}
        size="lg"
        dirty={dirty}
      >
        <ItemForm
          key={createFormKey}
          mode="create"
          taxes={taxes}
          incomeAccounts={incomeAccounts}
          expenseAccounts={expenseAccounts}
          inventoryAccounts={inventoryAccounts}
          categories={categories}
          showStock={showStock}
          submitting={createMutation.isPending}
          error={createError}
          onSubmit={(fields) => createMutation.mutate(fields)}
          onCancel={() => { setCreateOpen(false); setCreateError(null); setDirty(false); }}
          onDirtyChange={setDirty}
        />
      </FormDialog>

      <FormDialog
        open={editingItem !== undefined}
        onOpenChange={(open) => { if (!open) { setEditingId(null); setEditError(null); setDirty(false); } }}
        title={editingItem ? intl.formatMessage({ id: "items.editItem" }, { name: editingItem.name }) : ""}
        size="lg"
        dirty={dirty}
      >
        {editingItem && (
          <ItemForm
            key={editingItem.id}
            mode="edit"
            taxes={taxes}
            incomeAccounts={incomeAccounts}
            expenseAccounts={expenseAccounts}
            inventoryAccounts={inventoryAccounts}
          categories={categories}
          showStock={showStock}
            initial={editingItem}
            submitting={updateMutation.isPending}
            error={editError}
            onSubmit={(fields) => updateMutation.mutate({ id: editingItem.id, fields })}
            onCancel={() => { setEditingId(null); setEditError(null); setDirty(false); }}
            onDirtyChange={setDirty}
          />
        )}
      </FormDialog>

      <DataGrid
        gridId={ITEMS_GRID_ID}
        columns={columns}
        data={items}
        rowCount={total}
        isLoading={itemsQuery.isPending}
        getRowId={(item) => item.id}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "items.searchPlaceholder" })}
        emptyMessage={intl.formatMessage({ id: "items.noItems" })}
        exportFileName="items"
        getRowClassName={(item) => (item.defaultUnitPrice == null ? "text-muted-foreground/70" : undefined)}
        manualFiltering
        manualSorting={!isFullyLoaded}
        manualGrouping={!isFullyLoaded}
      />
    </div>
  );
}
