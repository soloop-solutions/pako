import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ItemAttributeResponse, ItemVariantResponse } from "@pako/shared";
import { Plus, X } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { cn } from "@/lib/utils";

const attributesKey = (companyId: string | null) => ["itemAttributes", companyId] as const;

function useItemAttributes() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: attributesKey(activeCompanyId),
    queryFn: () => apiClient.listItemAttributes(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
}

const price = (v: number | undefined) => (v == null ? "—" : `${v.toFixed(2)} €`);

// docs/POS_PLAN.md P2 variants: the attributes (size, colour…) and their values that variants are
// made of. A value a variant uses can't be removed — the server says so.
export function ItemAttributesDialog({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { canWrite } = useMyAccess();
  const attributes = useItemAttributes();
  const [editing, setEditing] = useState<ItemAttributeResponse | "new" | null>(null);
  const list = attributes.data ?? [];

  const columns = useMemo<ColumnDef<ItemAttributeResponse>[]>(
    () => [
      { accessorKey: "name", header: t("items.attributes.name") },
      {
        id: "values",
        header: t("items.attributes.values"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.values.map((v) => (
              <Badge key={v.id} variant="outline">{v.value}</Badge>
            ))}
          </span>
        ),
      },
      { accessorKey: "sortOrder", header: t("items.attributes.sortOrder"), meta: { numeric: true } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("items.attributes.title")} size="lg">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t("items.attributes.description")}</p>
          {canWrite("items") && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("items.attributes.new")}
            </Button>
          )}
        </div>
        <DataGrid
          gridId="item-attributes"
          columns={columns}
          data={list}
          rowCount={list.length}
          isLoading={attributes.isPending}
          getRowId={(a) => a.id}
          onRowClick={canWrite("items") ? setEditing : undefined}
          emptyMessage={t("items.attributes.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
      {editing && (
        <AttributeDialog attribute={editing === "new" ? null : editing} nextOrder={list.length} onClose={() => setEditing(null)} />
      )}
    </FormDialog>
  );
}

interface ValueDraft {
  key: string;
  id?: string;
  value: string;
}

function AttributeDialog({ attribute, nextOrder, onClose }: { attribute: ItemAttributeResponse | null; nextOrder: number; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [name, setName] = useState(attribute?.name ?? "");
  const [sortOrder, setSortOrder] = useState(String(attribute?.sortOrder ?? nextOrder));
  const [values, setValues] = useState<ValueDraft[]>(
    () => attribute?.values.map((v) => ({ key: v.id, id: v.id, value: v.value })) ?? [{ key: crypto.randomUUID(), value: "" }],
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        sortOrder: Number(sortOrder) || 0,
        // Values keep their order as listed; the ones without an id are added.
        values: values.filter((v) => v.value.trim()).map((v, i) => ({ id: v.id, value: v.value.trim(), sortOrder: i })),
      };
      return attribute
        ? apiClient.updateItemAttribute(activeCompanyId as string, attribute.id, body)
        : apiClient.createItemAttribute(activeCompanyId as string, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: attributesKey(activeCompanyId) });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("items.attributes.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && !save.isPending && onClose()} title={attribute ? attribute.name : t("items.attributes.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="attr-name">{t("items.attributes.name")}</Label>
            <Input id="attr-name" required maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("items.attributes.name.placeholder")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="attr-order">{t("items.attributes.sortOrder")}</Label>
            <Input id="attr-order" type="number" step="1" className="text-right tabular-nums" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
        </div>
        <p className="text-sm font-medium">{t("items.attributes.values")}</p>
        <ul className="flex flex-col gap-1">
          {values.map((v, i) => (
            <li key={v.key} className="flex items-center gap-2">
              <Input
                aria-label={t("items.attributes.value")}
                maxLength={60}
                value={v.value}
                onChange={(e) => setValues((all) => all.map((x) => (x.key === v.key ? { ...x, value: e.target.value } : x)))}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={intl.formatMessage({ id: "items.attributes.removeValue" }, { value: v.value || String(i + 1) })}
                onClick={() => setValues((all) => all.filter((x) => x.key !== v.key))}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setValues((all) => [...all, { key: crypto.randomUUID(), value: "" }])}>
          <Plus className="size-4" /> {t("items.attributes.addValue")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("items.attributes.removeHint")}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !name.trim() || !values.some((v) => v.value.trim())}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// An item's variants: pick values per attribute and generate every combination; then the variants
// as a size × colour matrix (exactly two attributes) or a list. Prices and stock are the server's.
export function ItemVariantsPanel({ itemId }: { itemId: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const attributes = useItemAttributes();
  const variantsKey = ["itemVariants", activeCompanyId, itemId] as const;
  const variants = useQuery({
    queryKey: variantsKey,
    queryFn: () => apiClient.listItemVariants(activeCompanyId as string, itemId),
    enabled: !!activeCompanyId,
  });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);

  const attrs = useMemo(() => attributes.data ?? [], [attributes.data]);
  const list = useMemo(() => variants.data ?? [], [variants.data]);
  // Until the cashier touches a chip, the values the existing variants use are the ones ticked.
  const used = useMemo(() => new Set(list.flatMap((v) => v.attributeValueIds)), [list]);
  const selected = picked ?? used;

  const generate = useMutation({
    mutationFn: () => apiClient.generateItemVariants(activeCompanyId as string, itemId, { attributeValueIds: [...selected] }),
    onSuccess: async (result) => {
      setError(null);
      setPicked(null);
      queryClient.setQueryData(variantsKey, result);
      await queryClient.invalidateQueries({ queryKey: ["items", activeCompanyId] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("items.variants.generateError"))),
  });

  function toggle(id: string) {
    setPicked(() => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // The attributes the variants are made of, in the server's order.
  const axes = useMemo(() => attrs.filter((a) => a.values.some((v) => used.has(v.id))), [attrs, used]);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("items.variants.hint")}</p>
        <Button size="sm" variant="outline" onClick={() => setManage(true)}>{t("items.attributes.manage")}</Button>
      </div>
      {attrs.length === 0 && !attributes.isPending && <p className="text-sm text-muted-foreground">{t("items.attributes.empty")}</p>}
      {attrs.map((a) => (
        <fieldset key={a.id} className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{a.name}</legend>
          <div className="flex flex-wrap gap-1">
            {a.values.map((v) => {
              const on = selected.has(v.id);
              return (
                <label
                  key={v.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm",
                    on ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground",
                  )}
                >
                  <input type="checkbox" className="size-3.5" checked={on} disabled={!canWrite("items")} onChange={() => toggle(v.id)} />
                  {v.value}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      {canWrite("items") && attrs.length > 0 && (
        <Button className="self-start" disabled={selected.size === 0 || generate.isPending} onClick={() => generate.mutate()}>
          {t("items.variants.generate")}
        </Button>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("items.variants.title")} ({list.length})</p>
        {axes.length === 2 && list.length > 0 ? (
          <VariantMatrix rows={axes[0]} columns={axes[1]} variants={list} />
        ) : (
          <VariantList variants={list} isLoading={variants.isPending} />
        )}
      </div>
      {manage && <ItemAttributesDialog onClose={() => setManage(false)} />}
    </div>
  );
}

function VariantList({ variants, isLoading }: { variants: ItemVariantResponse[]; isLoading: boolean }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const columns = useMemo<ColumnDef<ItemVariantResponse>[]>(
    () => [
      { accessorKey: "code", header: t("common.code"), meta: { numeric: true } },
      { accessorKey: "label", header: t("items.variants.label") },
      { id: "barcodes", header: t("items.barcodes"), enableSorting: false, accessorFn: (v) => v.barcodes.join(", ") || "—" },
      { id: "price", header: t("items.defaultPrice"), meta: { numeric: true }, accessorFn: (v) => v.price, cell: ({ row }) => price(row.original.price) },
      { accessorKey: "onHand", header: t("items.variants.onHand"), meta: { numeric: true }, cell: ({ row }) => intl.formatNumber(row.original.onHand) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  return (
    <DataGrid
      gridId="item-variants"
      columns={columns}
      data={variants}
      rowCount={variants.length}
      isLoading={isLoading}
      getRowId={(v) => v.itemId}
      emptyMessage={t("items.variants.empty")}
      manualFiltering={false}
      manualSorting={false}
      manualGrouping={false}
    />
  );
}

// Rows are the first attribute's values, columns the second's; a cell is the variant of that pair.
function VariantMatrix({ rows, columns, variants }: { rows: ItemAttributeResponse; columns: ItemAttributeResponse; variants: ItemVariantResponse[] }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const cell = (rowValue: string, columnValue: string) =>
    variants.find((v) => v.attributeValueIds.includes(rowValue) && v.attributeValueIds.includes(columnValue));
  const rowValues = rows.values.filter((r) => variants.some((v) => v.attributeValueIds.includes(r.id)));
  const columnValues = columns.values.filter((c) => variants.some((v) => v.attributeValueIds.includes(c.id)));
  return (
    <div className="overflow-x-auto" data-testid="variant-matrix">
      <div
        role="grid"
        aria-label={t("items.variants.title")}
        className="grid gap-px rounded-md border bg-border text-xs"
        style={{ gridTemplateColumns: `minmax(6rem,auto) repeat(${columnValues.length}, minmax(8rem,1fr))` }}
      >
        <div role="columnheader" className="bg-muted px-2 py-1 font-medium">{rows.name} \ {columns.name}</div>
        {columnValues.map((c) => (
          <div key={c.id} role="columnheader" className="bg-muted px-2 py-1 font-medium">{c.value}</div>
        ))}
        {rowValues.map((r) => (
          <div key={r.id} role="row" className="contents">
            <div role="rowheader" className="bg-muted px-2 py-1 font-medium">{r.value}</div>
            {columnValues.map((c) => {
              const v = cell(r.id, c.id);
              return (
                <div key={c.id} role="gridcell" className="bg-background px-2 py-1 tabular-nums">
                  {v ? (
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">#{v.code}{v.barcodes.length > 0 && ` · ${v.barcodes.join(", ")}`}</span>
                      <span className="flex justify-between gap-2">
                        <span className="font-semibold">{price(v.price)}</span>
                        <span title={t("items.variants.onHand")}>{intl.formatNumber(v.onHand)}</span>
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
