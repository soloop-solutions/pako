import { useEffect, useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PriceChangeSummaryResponse, PriceListItemResponse, PriceListResponse } from "@pako/shared";
import { Pencil, Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useWarehouses } from "@/hooks/useStock";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { PriceChangeState } from "@/lib/stock-enums";
import { cn } from "@/lib/utils";

const ITEMS_GRID = "price-list-items";
const CHANGES_GRID = "price-changes";

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// docs/INVENTORY_PLAN.md §12 P4 — sales price lists (company-wide and per shop) and the price
// changes (Nivelim) that set them. Prices are VAT-inclusive; a list never touches the ledger.
export function PriceLists() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const [tab, setTab] = useUrlParam("tab", "prices");
  const [listId, setListId] = useUrlParam("list", "", [`${ITEMS_GRID}.page`]);
  const [editing, setEditing] = useState<PriceListResponse | "new" | null>(null);
  const listsQuery = useQuery({
    queryKey: ["priceLists", activeCompanyId],
    queryFn: () => apiClient.listPriceLists(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const lists = useMemo(() => listsQuery.data ?? [], [listsQuery.data]);
  const selected = lists.find((l) => l.id === listId) ?? lists[0];

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("nav.priceLists")}</h2>
          <p className="text-sm text-muted-foreground">{t("nav.priceLists.description")}</p>
        </div>
        {canWrite("items") && (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("price.list.new")}
          </Button>
        )}
      </div>
      <div role="tablist" aria-label={t("nav.priceLists")} className="flex gap-1 border-b">
        {(["prices", "changes"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`price.tab.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {lists.length === 0 && !listsQuery.isPending ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("price.list.empty")}</CardContent>
          </Card>
        ) : tab === "changes" ? (
          <PriceChangesTab lists={lists} />
        ) : (
          selected && <PricesTab lists={lists} selected={selected} onSelect={setListId} onEdit={canWrite("items") ? setEditing : undefined} />
        )}
      </div>
      {editing && (
        <PriceListDialog
          list={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            setEditing(null);
            setListId(saved.id);
            await queryClient.invalidateQueries({ queryKey: ["priceLists", activeCompanyId] });
          }}
        />
      )}
    </div>
  );
}

function PricesTab({ lists, selected, onSelect, onEdit }: {
  lists: PriceListResponse[]; selected: PriceListResponse; onSelect: (id: string) => void; onEdit?: (list: PriceListResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const grid = useDataGridUrlState(ITEMS_GRID, 50);
  const [date, setDate] = useUrlParam("date", isoToday(), [`${ITEMS_GRID}.page`]);
  const [onlyPriced, setOnlyPriced] = useUrlParam("priced", "", [`${ITEMS_GRID}.page`]);
  const query = useQuery({
    queryKey: ["priceListItems", activeCompanyId, selected.id, date, grid.globalFilter, onlyPriced, grid.page, grid.pageSize],
    queryFn: () => apiClient.listPriceListItems(activeCompanyId as string, selected.id, date || undefined, grid.globalFilter || undefined,
      onlyPriced === "1", grid.page, grid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const price = (v: number | undefined) => (v == null ? "—" : intl.formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

  const columns = useMemo<ColumnDef<PriceListItemResponse>[]>(
    () => [
      { accessorKey: "itemCode", header: t("stock.col.code"), meta: { numeric: true } },
      { accessorKey: "itemName", header: t("stock.col.item") },
      { accessorKey: "unit", header: t("price.col.unit") },
      { accessorKey: "price", header: t("price.col.price"), meta: { numeric: true }, cell: ({ getValue }) => price(getValue() as number | undefined) },
      {
        accessorKey: "validFrom",
        header: t("price.col.validFrom"),
        cell: ({ getValue }) => (getValue() ? intl.formatDate(new Date(`${getValue() as string}T00:00`), { dateStyle: "medium" }) : "—"),
      },
      {
        accessorKey: "fallbackPrice",
        header: t(selected.warehouseId ? "price.col.companyPrice" : "price.col.itemPrice"),
        meta: { numeric: true },
        cell: ({ row }) => (
          <span className={row.original.price == null ? undefined : "text-muted-foreground"}>{price(row.original.fallbackPrice)}</span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, selected.warehouseId],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="pl-list">{t("price.list")}</Label>
            <Select
              id="pl-list"
              className="w-60"
              value={selected.id}
              onValueChange={onSelect}
              options={lists.map((l) => ({ value: l.id, label: l.warehouseName ? `${l.name} · ${l.warehouseName}` : l.name }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pl-date">{t("price.onDate")}</Label>
            <Input id="pl-date" type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <label className="flex h-8 items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyPriced === "1"} onChange={(e) => setOnlyPriced(e.target.checked ? "1" : "")} />
            {t("price.onlyPriced")}
          </label>
          {!selected.isActive && <Badge variant="secondary">{t("stock.wh.closed")}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {onEdit && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(selected)}>
              <Pencil className="size-4" />
              {t("price.list.edit")}
            </Button>
          )}
          {canWrite("items") && selected.isActive && (
            <Button size="sm" onClick={() => navigate(`/price-changes/new?list=${selected.id}`)}>
              <Plus className="size-4" />
              {t("price.change.new")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription className="mb-3">{t(selected.warehouseId ? "price.list.shopHint" : "price.list.companyHint")}</CardDescription>
        <DataGrid
          gridId={ITEMS_GRID}
          columns={columns}
          data={query.data?.items ?? []}
          rowCount={query.data?.total ?? 0}
          isLoading={query.isPending}
          getRowId={(r) => r.itemId}
          enableGlobalFilter
          globalFilterPlaceholder={t("stock.search")}
          emptyMessage={t("price.items.empty")}
          exportFileName="price-list"
        />
      </CardContent>
    </Card>
  );
}

function PriceChangesTab({ lists }: { lists: PriceListResponse[] }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const grid = useDataGridUrlState(CHANGES_GRID, 50);
  const [listFilter, setListFilter] = useUrlParam("changesList", "", [`${CHANGES_GRID}.page`]);
  const query = useQuery({
    queryKey: ["priceChanges", activeCompanyId, listFilter, grid.globalFilter, grid.page, grid.pageSize],
    queryFn: () => apiClient.listPriceChanges(activeCompanyId as string, listFilter || undefined, grid.globalFilter || undefined, grid.page, grid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<PriceChangeSummaryResponse>[]>(
    () => [
      { accessorKey: "date", header: t("stock.card.date"), cell: ({ getValue }) => intl.formatDate(new Date(`${getValue() as string}T00:00`), { dateStyle: "medium" }) },
      { accessorKey: "number", header: t("stock.doc.number"), cell: ({ getValue }) => (getValue() as string | undefined) ?? t("stock.doc.draftNumber") },
      { accessorKey: "priceListName", header: t("price.list") },
      { accessorKey: "lineCount", header: t("stock.doc.lines"), meta: { numeric: true } },
      {
        accessorKey: "totalDifference",
        header: t("price.col.difference"),
        meta: { numeric: true },
        cell: ({ row }) => (row.original.state === PriceChangeState.Posted ? formatAmount(row.original.totalDifference) : "—"),
      },
      {
        accessorKey: "state",
        header: t("stock.doc.state"),
        cell: ({ getValue }) => getValue() === PriceChangeState.Posted
          ? <Badge variant="success">{t("stock.doc.posted")}</Badge>
          : <Badge variant="outline" className="italic">{t("stock.doc.draft")}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pc-list">{t("price.list")}</Label>
          <Select
            id="pc-list"
            className="w-60"
            value={listFilter}
            onValueChange={setListFilter}
            options={[{ value: "", label: t("price.allLists") }, ...lists.map((l) => ({ value: l.id, label: l.name }))]}
          />
        </div>
      </CardHeader>
      <CardContent>
        <DataGrid
          gridId={CHANGES_GRID}
          columns={columns}
          data={query.data?.items ?? []}
          rowCount={query.data?.total ?? 0}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => (r.state === PriceChangeState.Draft ? "text-muted-foreground" : undefined)}
          onRowClick={(r) => navigate(`/price-changes/${r.id}`)}
          enableGlobalFilter
          globalFilterPlaceholder={t("stock.doc.search")}
          emptyMessage={t("price.change.empty")}
        />
      </CardContent>
    </Card>
  );
}

function PriceListDialog({ list, onClose, onSaved }: { list: PriceListResponse | null; onClose: () => void; onSaved: (saved: PriceListResponse) => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const warehouses = (useWarehouses().data ?? []).filter((w) => w.isActive || w.id === list?.warehouseId);
  const [name, setName] = useState(list?.name ?? "");
  const [warehouseId, setWarehouseId] = useState(list?.warehouseId ?? "");
  const [isActive, setIsActive] = useState(list?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [name, warehouseId]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), warehouseId: warehouseId || undefined, isActive };
      return list ? apiClient.updatePriceList(activeCompanyId as string, list.id, body) : apiClient.createPriceList(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("price.list.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={list ? list.name : t("price.list.new")} description={t("price.list.dialogHint")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="pl-name">{t("price.list.name")}</Label>
          <Input id="pl-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pl-warehouse">{t("price.list.warehouse")}</Label>
          <Select
            id="pl-warehouse"
            value={warehouseId}
            onValueChange={setWarehouseId}
            options={[{ value: "", label: t("price.list.companyWide") }, ...warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))]}
          />
        </div>
        {list && (
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
