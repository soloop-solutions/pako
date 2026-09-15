import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { useCompany } from "@/context/CompanyContext";
import type { ItemResponse } from "@pako/shared";

const ITEMS_GRID_ID = "items";

export function Items() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const urlState = useDataGridUrlState(ITEMS_GRID_ID, 50);

  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [barcodeItemId, setBarcodeItemId] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState("");
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  const itemsQueryKey = ["items", activeCompanyId, urlState.skip, urlState.take, urlState.globalFilter] as const;

  const itemsQuery = useQuery({
    queryKey: itemsQueryKey,
    queryFn: () => apiClient.itemsGET(activeCompanyId as string, urlState.skip, urlState.take, urlState.globalFilter || undefined),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  async function refreshItems() {
    await queryClient.invalidateQueries({ queryKey: ["items", activeCompanyId] });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setCreateError(null);
    setCreating(true);
    try {
      await apiClient.itemsPOST(activeCompanyId, {
        name: name.trim(),
        unit: unit.trim(),
        defaultUnitPrice: price ? parseFloat(price) : undefined,
      });
      setName("");
      setUnit("");
      setPrice("");
      urlState.setPage(1);
      await refreshItems();
    } catch (err) {
      setCreateError(getApiErrorMessage(err, intl.formatMessage({ id: "items.createError" })));
    } finally {
      setCreating(false);
    }
  }

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
    ],
    [intl, barcodeItemId, newBarcode, handleAddBarcode, handleRemoveBarcode],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const items = itemsQuery.data?.items ?? [];
  const total = itemsQuery.data?.total ?? 0;
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
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCreate}>
          {createError && (
            <Alert variant="destructive">
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-1 flex-col gap-1">
            <Label>{intl.formatMessage({ id: "items.name" })}</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Laptop HP ProBook 450" />
          </div>
          <div className="flex w-24 flex-col gap-1">
            <Label>{intl.formatMessage({ id: "items.unit" })}</Label>
            <Input required value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="copë" />
          </div>
          <div className="flex w-32 flex-col gap-1">
            <Label>{intl.formatMessage({ id: "items.defaultPrice" })}</Label>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </div>
          <Button type="submit" disabled={creating || !name.trim() || !unit.trim()}>
            {creating ? intl.formatMessage({ id: "items.creating" }) : intl.formatMessage({ id: "items.addItem" })}
          </Button>
        </form>
      </div>

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
        manualFiltering={!isFullyLoaded}
        manualSorting={!isFullyLoaded}
        manualGrouping={!isFullyLoaded}
      />
    </div>
  );
}
