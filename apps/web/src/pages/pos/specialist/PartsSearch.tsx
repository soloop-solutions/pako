import { useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { PartSearchResult } from "@pako/shared";
import { Search } from "lucide-react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useWarehouses } from "@/hooks/useStock";
import { ErrorAlert } from "@/pages/pos/hotel/hotel-shared";
import { Field } from "@/pages/pos/specialist/shared";
import { money, qty, usePartsSearch, type PartsQuery } from "@/pages/pos/specialist/specialist-utils";

const GRID_ID = "parts-search";
const ANY = "";

// The search form: a part number (our code, a barcode or any maker's number), or a vehicle (make,
// model, year). What is typed is only sent when the form is submitted.
export function PartsSearchFields({ initial, onSearch, compact = false }: {
  initial: PartsQuery;
  onSearch: (q: PartsQuery) => void;
  compact?: boolean;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const warehouses = useWarehouses().data ?? [];
  const [draft, setDraft] = useState<PartsQuery>(initial);
  const set = (patch: Partial<PartsQuery>) => setDraft((d) => ({ ...d, ...patch }));
  function submit(e: FormEvent) {
    e.preventDefault();
    onSearch(draft);
  }
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
      <Field id="parts-number" label={t("spec.parts.number")} className="w-56">
        <Input id="parts-number" autoFocus autoComplete="off" maxLength={60} value={draft.number} onChange={(e) => set({ number: e.target.value })} />
      </Field>
      <span className="pb-2 text-sm text-muted-foreground">{t("spec.parts.or")}</span>
      <Field id="parts-make" label={t("spec.parts.make")} className="w-36">
        <Input id="parts-make" maxLength={60} value={draft.make} onChange={(e) => set({ make: e.target.value })} />
      </Field>
      <Field id="parts-model" label={t("spec.parts.model")} className="w-36">
        <Input id="parts-model" maxLength={60} value={draft.model} onChange={(e) => set({ model: e.target.value })} />
      </Field>
      <Field id="parts-year" label={t("spec.parts.year")} className="w-24">
        <Input id="parts-year" inputMode="numeric" maxLength={4} value={draft.year} onChange={(e) => set({ year: e.target.value })} className="tabular-nums" />
      </Field>
      {!compact && (
        <Field id="parts-warehouse" label={t("spec.parts.warehouse")} className="w-48">
          <Select
            id="parts-warehouse"
            value={draft.warehouseId}
            onValueChange={(v) => set({ warehouseId: v })}
            options={[{ value: ANY, label: t("spec.parts.warehouse.all") }, ...warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))]}
          />
        </Field>
      )}
      <Button type="submit" disabled={!draft.number.trim() && !draft.make.trim()}>
        <Search className="size-4" /> {t("spec.parts.search")}
      </Button>
    </form>
  );
}

/** The match a result was found by: code, barcode, a maker's number, or vehicle fitment. */
export function MatchBadge({ result }: { result: PartSearchResult }) {
  const intl = useIntl();
  const known = ["code", "barcode", "reference", "fitment"].includes(result.match);
  return (
    <span className="flex items-center gap-1">
      <Badge variant={result.match === "reference" ? "outline" : "secondary"}>
        {known ? intl.formatMessage({ id: `spec.parts.match.${result.match}` }) : result.match}
      </Badge>
      {result.brand && <span className="text-xs text-muted-foreground">{result.brand} {result.number}</span>}
    </span>
  );
}

// docs/POS_PLAN.md §6.8 / P7 auto parts: the counter search — by any maker's part number or by the
// vehicle. Prices and stock are the server's (the warehouse's price list and balance).
export function PartsSearch() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [params, setParams] = useSearchParams();
  const query: PartsQuery = {
    number: params.get("number") ?? "",
    make: params.get("make") ?? "",
    model: params.get("model") ?? "",
    year: params.get("year") ?? "",
    warehouseId: params.get("warehouse") ?? "",
  };
  const results = usePartsSearch(query);

  function search(q: PartsQuery) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const values: Record<string, string> = { number: q.number.trim(), make: q.make.trim(), model: q.model.trim(), year: q.year.trim(), warehouse: q.warehouseId };
        for (const [k, v] of Object.entries(values)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        next.delete(`${GRID_ID}.page`);
        return next;
      },
      { replace: true },
    );
  }

  const columns = useMemo<ColumnDef<PartSearchResult>[]>(
    () => [
      { accessorKey: "code", header: t("common.code"), meta: { numeric: true } },
      { accessorKey: "name", header: t("common.name") },
      { id: "match", header: t("spec.parts.match"), accessorFn: (r) => r.match, cell: ({ row }) => <MatchBadge result={row.original} /> },
      { id: "price", header: t("spec.parts.price"), meta: { numeric: true }, accessorFn: (r) => r.price, cell: ({ row }) => (row.original.price == null ? "—" : money(row.original.price)) },
      { accessorKey: "onHand", header: t("spec.parts.onHand"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const rows = results.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("spec.nav.parts")}</CardTitle>
        <CardDescription>{t("spec.nav.parts.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <PartsSearchFields key={params.toString()} initial={query} onSearch={search} />
        <ErrorAlert message={results.error ? getApiErrorMessage(results.error, t("spec.loadError")) : null} />
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={results.isFetching}
          getRowId={(r) => r.itemId}
          emptyMessage={t(query.number || query.make ? "spec.parts.empty" : "spec.parts.prompt")}
          exportFileName="parts"
          manualSorting={false}
          manualFiltering={false}
        />
      </CardContent>
    </Card>
  );
}
