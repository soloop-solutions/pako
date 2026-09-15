import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { useCompany } from "@/context/CompanyContext";
import { AccountType } from "@/lib/ledger-enums";
import { itemTypeLabel, type ItemWithType } from "@/lib/item-types";
import { setItemTypesMockActive, setMockItemType } from "@/mocks/itemTypesMockFlag";
import { ensureAccountsMockWorkerStarted } from "@/mocks/mockInit";
import { ItemForm, type ItemFormFields } from "@/pages/items/ItemForm";
import type { AccountResponse, TaxDefinitionResponse } from "@pako/shared";

const ITEMS_GRID_ID = "items";

export function Items() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const urlState = useDataGridUrlState(ITEMS_GRID_ID, 50);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [barcodeItemId, setBarcodeItemId] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState("");
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  // F5 — the mocked `type` field only answers while this screen is actually on screen, same
  // synchronous-flag discipline as the F2 (chart of accounts) and F3 (lock dates) mocks — see
  // src/mocks/itemTypesMockFlag.ts / src/mocks/itemTypesHandlers.ts.
  const [mockReady, setMockReady] = useState(false);
  useEffect(() => {
    setItemTypesMockActive(true);
    let cancelled = false;
    void ensureAccountsMockWorkerStarted().then(() => {
      if (!cancelled) setMockReady(true);
    });
    return () => {
      cancelled = true;
      setMockReady(false);
      setItemTypesMockActive(false);
    };
  }, []);

  const itemsQueryKey = ["items", activeCompanyId, urlState.skip, urlState.take, urlState.globalFilter] as const;

  const itemsQuery = useQuery({
    queryKey: itemsQueryKey,
    queryFn: async () => {
      const result = await apiClient.itemsGET(activeCompanyId as string, urlState.skip, urlState.take, urlState.globalFilter || undefined);
      return result as unknown as { items: ItemWithType[]; total: number };
    },
    enabled: !!activeCompanyId && mockReady,
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
  const incomeAccounts = useMemo(() => accounts.filter((a) => a.accountType === AccountType.Income), [accounts]);
  const expenseAccounts = useMemo(() => accounts.filter((a) => a.accountType === AccountType.Expense), [accounts]);

  async function refreshItems() {
    await queryClient.invalidateQueries({ queryKey: ["items", activeCompanyId] });
  }

  const createMutation = useMutation({
    mutationFn: async (fields: ItemFormFields) => {
      if (!activeCompanyId) throw new Error("no active company");
      const created = await apiClient.itemsPOST(activeCompanyId, {
        name: fields.name,
        unit: fields.unit,
        defaultUnitPrice: fields.defaultUnitPrice,
        defaultTaxDefinitionId: fields.defaultTaxDefinitionId,
        defaultRevenueAccountId: fields.defaultRevenueAccountId,
        defaultExpenseAccountId: fields.defaultExpenseAccountId,
      });
      // F5 — MOCKED type, stored separately from the real create call. See
      // src/mocks/itemTypesMockFlag.ts.
      setMockItemType(created.id, fields.type);
      return created;
    },
    onSuccess: async () => {
      setCreateError(null);
      urlState.setPage(1);
      await refreshItems();
    },
    onError: (err: unknown) => setCreateError(getApiErrorMessage(err, intl.formatMessage({ id: "items.createError" }))),
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; fields: ItemFormFields }) => {
      if (!activeCompanyId) throw new Error("no active company");
      const updated = await apiClient.itemsPUT(activeCompanyId, vars.id, {
        name: vars.fields.name,
        unit: vars.fields.unit,
        defaultUnitPrice: vars.fields.defaultUnitPrice,
        defaultTaxDefinitionId: vars.fields.defaultTaxDefinitionId,
        defaultRevenueAccountId: vars.fields.defaultRevenueAccountId,
        defaultExpenseAccountId: vars.fields.defaultExpenseAccountId,
      });
      setMockItemType(updated.id, vars.fields.type);
      return updated;
    },
    onSuccess: async () => {
      setEditError(null);
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

  const columns = useMemo<ColumnDef<ItemWithType>[]>(
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
            disabled={editingId !== null && editingId !== row.original.id}
            onClick={() => {
              setEditingId(row.original.id);
              setEditError(null);
            }}
          >
            {intl.formatMessage({ id: "common.edit" })}
          </Button>
        ),
      },
    ],
    [intl, barcodeItemId, newBarcode, handleAddBarcode, handleRemoveBarcode, taxes, accounts, editingId],
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
      <div>
        <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "items.title" })}</h2>
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "items.description" })}</p>
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

      <div className="rounded-lg border p-4">
        <h3 className="mb-3 font-medium">{intl.formatMessage({ id: "items.newItem" })}</h3>
        <ItemForm
          mode="create"
          taxes={taxes}
          incomeAccounts={incomeAccounts}
          expenseAccounts={expenseAccounts}
          submitting={createMutation.isPending}
          error={createError}
          onSubmit={(fields) => createMutation.mutate(fields)}
        />
      </div>

      {editingItem && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 font-medium">{intl.formatMessage({ id: "items.editItem" }, { name: editingItem.name })}</h3>
          <ItemForm
            // Bug fix (code review): ItemForm seeds its fields from `initial` only on first
            // mount (plain useState). Without a key tied to the item being edited, switching from
            // editing item A to item B kept the same React element in place — it didn't remount,
            // so it kept showing A's stale values, and saving would silently overwrite B with A's
            // data. The `disabled` guard on the row's Edit button above closes the same gap from
            // the other side; this key is the actual fix.
            key={editingItem.id}
            mode="edit"
            taxes={taxes}
            incomeAccounts={incomeAccounts}
            expenseAccounts={expenseAccounts}
            initial={editingItem}
            submitting={updateMutation.isPending}
            error={editError}
            onSubmit={(fields) => updateMutation.mutate({ id: editingItem.id, fields })}
            onCancel={() => {
              setEditingId(null);
              setEditError(null);
            }}
          />
        </div>
      )}

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
