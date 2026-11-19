import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PortalCatalogueItemResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { usePortal, useRequiredPortalCompanyId } from "@/pages/portal/portal-context";

const GRID_ID = "portalCatalogue";

// What the company sells, at this customer's prices (the API resolves them: own price list,
// wholesale tier, period discount). Search and category live in the URL.
export function PortalCatalogue() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const companyId = useRequiredPortalCompanyId();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [categoryId, setCategoryId] = useUrlParam("category", "", [`${GRID_ID}.page`]);

  const query = useQuery({
    queryKey: ["portal", companyId, "catalogue", grid.globalFilter, categoryId, grid.page, grid.pageSize],
    queryFn: () => apiClient.listPortalCatalogue(companyId, grid.globalFilter || undefined, categoryId || undefined, grid.page, grid.pageSize),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: ["portal", companyId, "categories"], queryFn: () => apiClient.listPortalCategories(companyId) }).data ?? [];

  const columns = useMemo<ColumnDef<PortalCatalogueItemResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("portal.col.item"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            {row.original.description && <span className="text-xs text-muted-foreground">{row.original.description}</span>}
          </div>
        ),
      },
      { accessorKey: "categoryName", header: t("portal.col.category"), enableSorting: false, cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "unit", header: t("portal.col.unit"), enableSorting: false },
      {
        accessorKey: "price", header: t("portal.col.price"), enableSorting: false, meta: { numeric: true },
        cell: ({ getValue }) => formatAmount(getValue() as number),
      },
      {
        accessorKey: "discountPercent", header: t("portal.col.discount"), enableSorting: false, meta: { numeric: true },
        cell: ({ getValue }) => ((getValue() as number) > 0 ? `${getValue() as number}%` : "—"),
      },
      {
        accessorKey: "priceAfterDiscount", header: t("portal.col.yourPrice"), enableSorting: false, meta: { numeric: true },
        cell: ({ getValue }) => <span className="font-medium">{formatAmount(getValue() as number)}</span>,
      },
      {
        accessorKey: "inStock", header: t("portal.col.stock"), enableSorting: false,
        cell: ({ getValue }) => {
          const value = getValue() as boolean | undefined;
          if (value == null) return null;
          return value
            ? <Badge variant="outline">{t("portal.inStock")}</Badge>
            : <Badge variant="secondary">{t("portal.outOfStock")}</Badge>;
        },
      },
      { id: "add", header: "", enableSorting: false, cell: ({ row }) => <AddToCart item={row.original} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("portal.catalogueTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("portal.catalogueHint")}</p>
        </div>
        {categories.length > 0 && (
          <div className="flex w-64 flex-col gap-1">
            <Label htmlFor="portal-category">{t("portal.col.category")}</Label>
            <SearchableSelect
              id="portal-category"
              value={categoryId}
              onChange={setCategoryId}
              placeholder={t("portal.allCategories")}
              emptyOptionLabel={t("portal.allCategories")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        )}
      </div>
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(query.error, t("portal.loadError"))}</AlertDescription>
        </Alert>
      )}
      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={query.data?.items ?? []}
        rowCount={query.data?.total ?? 0}
        isLoading={query.isPending}
        getRowId={(i) => i.itemId}
        enableGlobalFilter
        globalFilterPlaceholder={t("portal.searchItems")}
        emptyMessage={t("portal.catalogueEmpty")}
      />
    </div>
  );
}

function AddToCart({ item }: { item: PortalCatalogueItemResponse }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { addToCart, cart } = usePortal();
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const inCart = cart.filter((l) => l.itemId === item.itemId).length > 0;
  const amount = Number(quantity.replace(",", "."));
  const valid = Number.isFinite(amount) && amount > 0;

  function add() {
    if (!valid) return;
    addToCart({ itemId: item.itemId, name: item.name, unitName: unit || undefined, quantity: amount });
    toast.success(intl.formatMessage({ id: "portal.added" }, { item: item.name }));
    setQuantity("1");
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        aria-label={intl.formatMessage({ id: "portal.quantityFor" }, { item: item.name })}
        className="h-7 w-16 text-right tabular-nums"
        inputMode="decimal"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      {item.units.length > 0 && (
        <Select
          aria-label={intl.formatMessage({ id: "portal.unitFor" }, { item: item.name })}
          className="h-7 w-24"
          value={unit}
          placeholder={item.unit}
          onValueChange={setUnit}
          options={[{ value: "", label: item.unit }, ...item.units.map((u) => ({ value: u.unitName, label: `${u.unitName} (${formatAmount(u.price)})` }))]}
        />
      )}
      <Button size="xs" variant={inCart ? "outline" : "default"} disabled={!valid} onClick={add} aria-label={intl.formatMessage({ id: "portal.addItem" }, { item: item.name })}>
        <Plus className="size-3.5" />
        {t("portal.add")}
      </Button>
    </div>
  );
}
