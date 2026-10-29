import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { FileResponse, WithholdingTaxEntryResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { WithholdingTaxForm, type WithholdingTaxFormFields } from "@/pages/tax/WithholdingTaxForm";

const GRID_ID = "withholdingTax";
const SORTABLE_COLUMNS = new Set(["name", "personalNumber"]);

function downloadFileResponse(file: FileResponse, fallbackFileName: string): void {
  const url = URL.createObjectURL(file.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName ?? fallbackFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function money(value: number | undefined): string {
  return typeof value === "number" && value !== 0 ? value.toFixed(2) : "—";
}

function isValidYear(value: string): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100;
}

function parseYear(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : new Date().getFullYear();
}

export function WithholdingTax() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const urlState = useDataGridUrlState(GRID_ID, 50);
  const [searchParams, setSearchParams] = useSearchParams();
  const year = parseYear(searchParams.get("year"));
  const [yearDraft, setYearDraft] = useState(String(year));
  const [draftSource, setDraftSource] = useState(year);
  if (draftSource !== year) {
    setDraftSource(year);
    setYearDraft(String(year));
  }

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const sortParam =
    urlState.sort && SORTABLE_COLUMNS.has(urlState.sort.id) ? `${urlState.sort.desc ? "-" : ""}${urlState.sort.id}` : undefined;

  const listQuery = useQuery({
    queryKey: ["withholdingTax", activeCompanyId, year, urlState.skip, urlState.take, urlState.globalFilter, sortParam] as const,
    queryFn: () => {
      const page = Math.floor(urlState.skip / urlState.take) + 1;
      return apiClient.withholdingTaxGET(
        activeCompanyId as string,
        year,
        page,
        urlState.take,
        urlState.globalFilter || undefined,
        sortParam,
      );
    },
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const countriesQuery = useQuery({
    queryKey: ["withholdingTaxCountries", activeCompanyId],
    queryFn: () => apiClient.countries(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: Infinity,
  });

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const total = listQuery.data?.total ?? 0;
  const totals = listQuery.data?.totals;
  const countries = countriesQuery.data?.countries ?? [];
  const defaultCountry = countriesQuery.data?.defaultCountry ?? "Kosova";
  const editingEntry = editingId ? items.find((e) => e.id === editingId) : undefined;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["withholdingTax", activeCompanyId] });
  }

  function toRequest(fields: WithholdingTaxFormFields) {
    return { ...fields, year, rentalAreaM2: fields.rentalAreaM2, monthlyGrossRent: fields.monthlyGrossRent };
  }

  const createMutation = useMutation({
    mutationFn: (fields: WithholdingTaxFormFields) => {
      if (!activeCompanyId) throw new Error("no active company");
      return apiClient.withholdingTaxPOST(activeCompanyId, toRequest(fields));
    },
    onSuccess: async () => {
      setFormError(null);
      setFormOpen(false);
      urlState.setPage(1);
      await refresh();
    },
    onError: (err: unknown) => setFormError(getApiErrorMessage(err, intl.formatMessage({ id: "withholdingTax.saveError" }))),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; fields: WithholdingTaxFormFields }) => {
      if (!activeCompanyId) throw new Error("no active company");
      return apiClient.withholdingTaxPUT(activeCompanyId, vars.id, toRequest(vars.fields));
    },
    onSuccess: async () => {
      setFormError(null);
      setEditingId(null);
      await refresh();
    },
    onError: (err: unknown) => setFormError(getApiErrorMessage(err, intl.formatMessage({ id: "withholdingTax.saveError" }))),
  });

  const { mutate: deleteEntry, isPending: deleting } = useMutation({
    mutationFn: (id: string) => {
      if (!activeCompanyId) throw new Error("no active company");
      return apiClient.withholdingTaxDELETE(activeCompanyId, id);
    },
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: (err: unknown) => setActionError(getApiErrorMessage(err, intl.formatMessage({ id: "withholdingTax.deleteError" }))),
  });

  async function exportYear() {
    if (!activeCompanyId) return;
    setActionError(null);
    setExporting(true);
    try {
      const file = await apiClient.withholdingTaxExport(activeCompanyId, year);
      downloadFileResponse(file, `tatimi-ne-burim-${year}.xlsx`);
    } catch (err) {
      setActionError(getApiErrorMessage(err, intl.formatMessage({ id: "withholdingTax.exportError" })));
    } finally {
      setExporting(false);
    }
  }

  function changeYear(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set("year", value);
    next.delete(`${GRID_ID}.page`);
    setSearchParams(next);
    setEditingId(null);
  }

  const columns = useMemo<ColumnDef<WithholdingTaxEntryResponse>[]>(
    () => [
      { accessorKey: "personalNumber", header: intl.formatMessage({ id: "withholdingTax.personalNumber" }) },
      { accessorKey: "name", header: intl.formatMessage({ id: "withholdingTax.name" }) },
      { accessorKey: "grossInterest", header: intl.formatMessage({ id: "withholdingTax.grossInterest" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "propertyRights", header: intl.formatMessage({ id: "withholdingTax.propertyRights" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "lotteryWinnings", header: intl.formatMessage({ id: "withholdingTax.lotteryWinnings" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "withheldTax", header: intl.formatMessage({ id: "withholdingTax.withheldTax" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "grossRent", header: intl.formatMessage({ id: "withholdingTax.grossRent" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "nonResidentEntertainer", header: intl.formatMessage({ id: "withholdingTax.nonResidentEntertainer" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "nonResidentServices", header: intl.formatMessage({ id: "withholdingTax.nonResidentServices" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "nonResidentWithheldTax", header: intl.formatMessage({ id: "withholdingTax.nonResidentWithheldTax" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "nonEntrepreneur", header: intl.formatMessage({ id: "withholdingTax.nonEntrepreneur" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { accessorKey: "rentalAreaM2", header: intl.formatMessage({ id: "withholdingTax.rentalAreaM2" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number | undefined) },
      { accessorKey: "monthlyGrossRent", header: intl.formatMessage({ id: "withholdingTax.monthlyGrossRent" }), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number | undefined) },
      { accessorKey: "country", header: intl.formatMessage({ id: "withholdingTax.country" }), enableSorting: false },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              disabled={editingId !== null && editingId !== row.original.id}
              onClick={() => {
                setEditingId(row.original.id);
                setFormOpen(false);
                setFormError(null);
              }}
            >
              {intl.formatMessage({ id: "common.edit" })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-destructive"
              disabled={deleting}
              onClick={() => {
                if (window.confirm(intl.formatMessage({ id: "withholdingTax.deleteConfirm" }, { name: row.original.name }))) {
                  deleteEntry(row.original.id);
                }
              }}
            >
              {intl.formatMessage({ id: "common.delete" })}
            </Button>
          </div>
        ),
      },
    ],
    [intl, editingId, deleting, deleteEntry],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = listQuery.isError ? getApiErrorMessage(listQuery.error, intl.formatMessage({ id: "withholdingTax.loadError" })) : null;
  const percent = (rate: number | undefined) => intl.formatNumber(rate ?? 0, { style: "percent", maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "withholdingTax.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "withholdingTax.description" })}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="wht-year">{intl.formatMessage({ id: "withholdingTax.year" })}</Label>
            <Input
              id="wht-year"
              type="number"
              min={2000}
              max={2100}
              className="w-24 tabular-nums"
              value={yearDraft}
              onChange={(e) => {
                setYearDraft(e.target.value);
                if (isValidYear(e.target.value)) changeYear(e.target.value);
              }}
              onBlur={() => setYearDraft(String(year))}
            />
          </div>
          <Button variant="outline" onClick={exportYear} disabled={exporting || total === 0}>
            <Download className="size-4" />
            {intl.formatMessage({ id: exporting ? "withholdingTax.exporting" : "withholdingTax.export" })}
          </Button>
          <Button
            onClick={() => {
              setFormOpen((open) => !open);
              setEditingId(null);
              setFormError(null);
            }}
          >
            {intl.formatMessage({ id: "withholdingTax.addEntry" })}
          </Button>
        </div>
      </div>

      {listQuery.data && (
        <p className="text-xs text-muted-foreground">
          {intl.formatMessage(
            { id: "withholdingTax.rateNote" },
            { standard: percent(listQuery.data.standardRate), nonResident: percent(listQuery.data.nonResidentRate) },
          )}
        </p>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {formOpen && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 font-medium">{intl.formatMessage({ id: "withholdingTax.addEntry" })}</h3>
          <WithholdingTaxForm
            mode="create"
            countries={countries}
            defaultCountry={defaultCountry}
            submitting={createMutation.isPending}
            error={formError}
            onSubmit={(fields) => createMutation.mutate(fields)}
            onCancel={() => {
              setFormOpen(false);
              setFormError(null);
            }}
          />
        </div>
      )}

      {editingEntry && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 font-medium">{intl.formatMessage({ id: "withholdingTax.editEntry" }, { name: editingEntry.name })}</h3>
          <WithholdingTaxForm
            key={editingEntry.id}
            mode="edit"
            countries={countries}
            defaultCountry={defaultCountry}
            initial={editingEntry}
            submitting={updateMutation.isPending}
            error={formError}
            onSubmit={(fields) => updateMutation.mutate({ id: editingEntry.id, fields })}
            onCancel={() => {
              setEditingId(null);
              setFormError(null);
            }}
          />
        </div>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={items}
        rowCount={total}
        isLoading={listQuery.isPending}
        getRowId={(entry) => entry.id}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "withholdingTax.searchPlaceholder" })}
        emptyMessage={intl.formatMessage({ id: "withholdingTax.noEntries" })}
        exportFileName={`withholding-tax-${year}`}
      />

      {totals && total > 0 && (
        <div className="rounded-lg border p-4" data-testid="withholding-tax-totals">
          <h3 className="mb-3 font-medium">{intl.formatMessage({ id: "withholdingTax.totals" })}</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {(
              [
                ["withholdingTax.grossInterest", totals.grossInterest],
                ["withholdingTax.propertyRights", totals.propertyRights],
                ["withholdingTax.lotteryWinnings", totals.lotteryWinnings],
                ["withholdingTax.withheldTax", totals.withheldTax],
                ["withholdingTax.grossRent", totals.grossRent],
                ["withholdingTax.nonResidentEntertainer", totals.nonResidentEntertainer],
                ["withholdingTax.nonResidentServices", totals.nonResidentServices],
                ["withholdingTax.nonResidentWithheldTax", totals.nonResidentWithheldTax],
                ["withholdingTax.nonEntrepreneur", totals.nonEntrepreneur],
              ] as const
            ).map(([labelId, value]) => (
              <div key={labelId} className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: labelId })}</dt>
                <dd className="tabular-nums">{value.toFixed(2)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
