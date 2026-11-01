import { useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { SiteResponse, StockDocumentResponse, StockDocumentSummaryResponse } from "@pako/shared";
import { Plus, Truck, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useItemSearch, useWarehouses } from "@/hooks/useStock";
import { vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate, isoToday } from "@/lib/sales-order-enums";
import { StockDocumentState, StockDocumentType } from "@/lib/stock-enums";
import { ErrorAlert, Field } from "@/pages/verticals/shared";
import { amount, gridKeyDown, parseNum, useT } from "@/pages/verticals/verticals-utils";

interface IssueLine { itemId: string; quantity: string; costCodeId: string }
const emptyLine = (): IssueLine => ({ itemId: "", quantity: "", costCodeId: "" });

const GRID_ID = "site-issues";

// docs/ERP_VERTICALS_PLAN.md §1 — materials issued from a warehouse to the site (fletëdalje për
// kantier): a SiteIssue stock document, charged to the site's project at average cost.
export function SiteMaterialsTab({ site }: { site: SiteResponse }) {
  const intl = useIntl();
  const t = useT();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const [open, setOpen] = useState(false);
  const grid = useDataGridUrlState(GRID_ID, 50);
  const query = useQuery({
    queryKey: [...vxKeys.siteIssues(activeCompanyId, site.id), grid.page, grid.pageSize],
    queryFn: () => apiClient.listStockDocuments(activeCompanyId as string, StockDocumentType.SiteIssue, undefined, grid.page, grid.pageSize, site.id),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const columns = useMemo<ColumnDef<StockDocumentSummaryResponse>[]>(
    () => [
      { accessorKey: "date", header: t("common.date"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { accessorKey: "number", header: t("vx.number"), cell: ({ row }) => row.original.number ?? <Badge variant="draft">{t("vx.draft")}</Badge> },
      { accessorKey: "warehouseName", header: t("vx.warehouse") },
      { accessorKey: "lineCount", header: t("vx.materials.lines"), meta: { numeric: true } },
      { accessorKey: "totalValue", header: t("vx.materials.value"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("vx.materials.title")}</CardTitle>
          <CardDescription>{t("vx.materials.hint")}</CardDescription>
        </div>
        {canWrite("inventory") && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Truck className="size-4" />{t("vx.materials.issue")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={query.data?.items ?? []}
          rowCount={query.data?.total ?? 0}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => (r.state === StockDocumentState.Draft ? "text-muted-foreground italic" : undefined)}
          onRowClick={(r) => navigate(`/stock-documents/${r.id}`)}
          emptyMessage={t("vx.materials.empty")}
        />
      </CardContent>
      {open && <IssueDialog site={site} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function IssueDialog({ site, onClose }: { site: SiteResponse; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const warehouses = (useWarehouses().data ?? []).filter((w) => w.isActive);
  const itemSearch = useItemSearch({ trackedOnly: true });
  const [date, setDate] = useState(isoToday());
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<IssueLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  // A draft the post was refused for: kept, and linked, so it can be posted by someone allowed to.
  const [draft, setDraft] = useState<StockDocumentResponse | null>(null);
  const effectiveWarehouse = warehouseId || warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || "";
  const itemOptions = itemSearch.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.unit }));
  const costCodeOptions = [{ value: "", label: t("vx.materials.noCostCode") }, ...site.costCodes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))];

  const issue = useMutation({
    mutationFn: async () => {
      const doc = draft ?? await apiClient.createStockDocument(activeCompanyId as string, {
        type: StockDocumentType.SiteIssue,
        date,
        warehouseId: effectiveWarehouse,
        siteId: site.id,
        lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, quantity: parseNum(l.quantity) || 0, costCodeId: l.costCodeId || undefined })),
      });
      setDraft(doc);
      return apiClient.postStockDocument(activeCompanyId as string, doc.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: vxKeys.siteIssues(activeCompanyId, site.id) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.siteProgress(activeCompanyId, site.id) });
      onClose();
    },
    onError: async (err: unknown) => {
      setError(getApiErrorMessage(err, t("vx.materials.issueError")));
      await queryClient.invalidateQueries({ queryKey: vxKeys.siteIssues(activeCompanyId, site.id) });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lines.some((l) => l.itemId && parseNum(l.quantity) > 0)) return setError(t("vx.materials.noLines"));
    issue.mutate();
  }
  const setLine = (i: number, patch: Partial<IssueLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("vx.materials.issueTitle", { site: site.name })} size="lg">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert error={error} />
        {draft && (
          <p className="text-sm text-muted-foreground">
            {t("vx.materials.draftKept")}{" "}
            <Link className="text-primary underline" to={`/stock-documents/${draft.id}`}>{t("vx.materials.openDraft")}</Link>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="issue-date" label={t("common.date")}>
            <Input id="issue-date" type="date" required value={date} disabled={!!draft} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="issue-warehouse" label={t("vx.warehouse")}>
            <Select id="issue-warehouse" value={effectiveWarehouse} disabled={!!draft} onValueChange={setWarehouseId}
              options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
          </Field>
        </div>
        <div className="flex flex-col gap-1" data-edit-grid>
          <div className="grid grid-cols-[minmax(12rem,2fr)_7rem_minmax(10rem,1fr)_2.25rem] gap-2 text-xs font-medium text-muted-foreground">
            <span>{t("vx.item")}</span><span className="text-right">{t("common.quantity")}</span><span>{t("vx.costCode")}</span><span />
          </div>
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[minmax(12rem,2fr)_7rem_minmax(10rem,1fr)_2.25rem] items-center gap-2" data-testid="issue-line">
              <SearchableSelect value={line.itemId} onChange={(v) => setLine(i, { itemId: v })} aria-label={t("vx.item")} disabled={!!draft}
                placeholder={t("vx.pickItem")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")}
                options={itemOptions} onSearchChange={itemSearch.onSearchChange} />
              <Input className="h-7 text-right tnum" inputMode="decimal" aria-label={t("common.quantity")} value={line.quantity} disabled={!!draft}
                data-row={i} data-col="qty" onKeyDown={gridKeyDown} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <Select value={line.costCodeId} onValueChange={(v) => setLine(i, { costCodeId: v })} aria-label={t("vx.costCode")} disabled={!!draft}
                options={costCodeOptions} />
              <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t("common.remove")} disabled={!!draft}
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [emptyLine()]))}>
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          {!draft && (
            <Button type="button" size="xs" variant="ghost" className="w-fit" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              <Plus className="size-3.5" />{t("vx.addLine")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("vx.materials.postHint")}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={issue.isPending || !effectiveWarehouse}>{draft ? t("vx.materials.retryPost") : t("vx.materials.issueAndPost")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
