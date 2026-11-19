import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { AssetCategoryResponse, DepreciationScheduleLineResponse, FixedAssetResponse, SaveFixedAssetRequest } from "@pako/shared";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-context";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useMyAccess } from "@/hooks/useMyAccess";
import { formatDisplayDate } from "@/lib/dates";
import { formatAmount } from "@/lib/payroll-enums";
import { AssetStatusBadge } from "@/pages/assets/AssetRegisterTab";
import { accountOptions, formatMonth, todayIso, usePostableAccounts } from "@/pages/assets/shared";

type Props = { companyId: string; assetId: string | null; onClose: () => void };

// One asset: create or edit it, see its depreciation plan, dispose of it or delete it.
export function AssetDialog({ companyId, assetId, onClose }: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const queryClient = useQueryClient();
  const { canWrite, canApprove } = useMyAccess();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["fixedAsset", companyId, assetId],
    queryFn: () => apiClient.getFixedAsset(companyId, assetId as string),
    enabled: !!assetId,
  });
  const categories = useQuery({ queryKey: ["assetCategories", companyId], queryFn: () => apiClient.listAssetCategories(companyId) }).data;
  const asset = detail.data?.asset;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["fixedAssets", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["fixedAsset", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["assetCategories", companyId] }),
    ]);
  }

  const save = useMutation({
    mutationFn: (request: SaveFixedAssetRequest) =>
      assetId ? apiClient.updateFixedAsset(companyId, assetId, request) : apiClient.createFixedAsset(companyId, request),
    onSuccess: async (saved) => {
      toast.success(intl.formatMessage({ id: "assets.saved" }, { code: saved.code }));
      await refresh();
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("assets.saveError"))),
  });

  const remove = useMutation({
    mutationFn: () => apiClient.deleteFixedAsset(companyId, assetId as string),
    onSuccess: async () => {
      toast.success(t("assets.deleted"));
      await refresh();
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("assets.saveError"))),
  });

  const editable = canWrite("accounting");
  const title = assetId ? (asset ? `${asset.code} · ${asset.name}` : t("assets.loading")) : t("assets.new");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {asset && <AssetStatusBadge asset={asset} />}
          </DialogTitle>
          <DialogDescription>{t("assets.dialogDescription")}</DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {detail.isError && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(detail.error, t("assets.loadError"))}</AlertDescription>
          </Alert>
        )}

        {(!assetId || asset) && categories && (
          <AssetForm
            key={asset?.id ?? "new"}
            initial={asset ?? null}
            categories={categories}
            readOnly={!editable || asset?.status === "Disposed"}
            submitting={save.isPending || remove.isPending}
            onSubmit={(request) => {
              setError(null);
              save.mutate(request);
            }}
            onCancel={onClose}
            onDelete={
              asset && editable && !asset.hasDepreciation
                ? () => confirm(intl.formatMessage({ id: "assets.deleteConfirm" }, { code: asset.code }), () => remove.mutate(), { confirmLabel: t("common.delete"), destructive: true })
                : undefined
            }
          />
        )}

        {asset && <AssetFigures asset={asset} />}
        {asset && asset.isDepreciable && <DepreciationPlan lines={detail.data?.schedule ?? []} />}
        {asset && asset.status === "Active" && canApprove("accounting") && (
          <DisposeSection companyId={companyId} asset={asset} onDisposed={async () => { await refresh(); }} />
        )}
        {asset?.disposalJournalEntryId && (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: "assets.disposedOn" }, { date: formatDisplayDate(asset.disposedOn), proceeds: formatAmount(asset.disposalProceeds) })}{" "}
            <Link className="underline" to={`/ledger?entry=${asset.disposalJournalEntryId}`}>{t("assets.openEntry")}</Link>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssetForm({
  initial,
  categories,
  readOnly,
  submitting,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: FixedAssetResponse | null;
  categories: AssetCategoryResponse[];
  readOnly: boolean;
  submitting: boolean;
  onSubmit: (request: SaveFixedAssetRequest) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const planLocked = readOnly || !!initial?.hasDepreciation;
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [acquisitionDate, setAcquisitionDate] = useState(initial?.acquisitionDate ?? todayIso());
  const [inServiceDate, setInServiceDate] = useState(initial?.inServiceDate ?? todayIso());
  const [cost, setCost] = useState(initial ? String(initial.cost) : "");
  const [residual, setResidual] = useState(initial ? String(initial.residualValue) : "0");
  const [life, setLife] = useState(initial ? String(initial.usefulLifeMonths) : "");
  const [opening, setOpening] = useState(initial ? String(initial.openingAccumulatedDepreciation) : "0");
  const [serial, setSerial] = useState(initial?.serialNumber ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const category = categories.find((c) => c.id === categoryId);
  const depreciable = category?.isDepreciable ?? true;
  const options = categories.filter((c) => c.isActive || c.id === categoryId).map((c) => ({ value: c.id, label: c.name }));

  function pickCategory(id: string) {
    setCategoryId(id);
    const picked = categories.find((c) => c.id === id);
    if (picked && !initial) setLife(picked.isDepreciable ? String(picked.defaultUsefulLifeMonths) : "");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      code: code.trim() || undefined,
      name: name.trim(),
      categoryId,
      acquisitionDate,
      inServiceDate,
      cost: parseFloat(cost) || 0,
      residualValue: parseFloat(residual) || 0,
      usefulLifeMonths: depreciable && life ? parseInt(life, 10) : undefined,
      openingAccumulatedDepreciation: parseFloat(opening) || 0,
      serialNumber: serial.trim() || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {planLocked && initial && !readOnly && <p className="text-sm text-muted-foreground">{t("assets.planLockedHint")}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FormField label={t("assets.col.code")} htmlFor="asset-code" hint={initial ? undefined : t("assets.codeHint")}>
          <Input id="asset-code" maxLength={32} value={code} disabled={readOnly} onChange={(e) => setCode(e.target.value)} />
        </FormField>
        <FormField label={t("assets.col.name")} htmlFor="asset-name" required className="sm:col-span-2">
          <Input id="asset-name" required maxLength={256} value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={t("assets.col.category")} htmlFor="asset-category" required>
          <SearchableSelect
            id="asset-category"
            value={categoryId}
            onChange={pickCategory}
            disabled={planLocked}
            options={options}
            placeholder={t("assets.chooseCategory")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("common.noResults")}
          />
        </FormField>
        <FormField label={t("assets.acquisitionDate")} htmlFor="asset-acquired" required>
          <Input id="asset-acquired" type="date" required value={acquisitionDate} disabled={planLocked} onChange={(e) => setAcquisitionDate(e.target.value)} />
        </FormField>
        <FormField label={t("assets.inServiceDate")} htmlFor="asset-in-service" required hint={t("assets.inServiceHint")}>
          <Input id="asset-in-service" type="date" required value={inServiceDate} disabled={planLocked} onChange={(e) => setInServiceDate(e.target.value)} />
        </FormField>
        <FormField label={t("assets.col.cost")} htmlFor="asset-cost" required>
          <Input id="asset-cost" type="number" min="0.01" step="0.01" required value={cost} disabled={planLocked} onChange={(e) => setCost(e.target.value)} />
        </FormField>
        <FormField label={t("assets.residualValue")} htmlFor="asset-residual">
          <Input id="asset-residual" type="number" min="0" step="0.01" value={residual} disabled={planLocked || !depreciable} onChange={(e) => setResidual(e.target.value)} />
        </FormField>
        {depreciable && (
          <FormField label={t("assets.usefulLifeMonths")} htmlFor="asset-life" required hint={category ? intl.formatMessage({ id: "assets.categoryLifeHint" }, { months: category.defaultUsefulLifeMonths }) : undefined}>
            <Input id="asset-life" type="number" min="1" max="1200" step="1" required value={life} disabled={planLocked} onChange={(e) => setLife(e.target.value)} />
          </FormField>
        )}
        {depreciable && (
          <FormField label={t("assets.openingAccumulated")} htmlFor="asset-opening" hint={t("assets.openingAccumulatedHint")}>
            <Input id="asset-opening" type="number" min="0" step="0.01" value={opening} disabled={planLocked} onChange={(e) => setOpening(e.target.value)} />
          </FormField>
        )}
        <FormField label={t("assets.serialNumber")} htmlFor="asset-serial">
          <Input id="asset-serial" maxLength={128} value={serial} disabled={readOnly} onChange={(e) => setSerial(e.target.value)} />
        </FormField>
        <FormField label={t("assets.location")} htmlFor="asset-location">
          <Input id="asset-location" maxLength={128} value={location} disabled={readOnly} onChange={(e) => setLocation(e.target.value)} />
        </FormField>
        <FormField label={t("assets.notes")} htmlFor="asset-notes" className="sm:col-span-4">
          <Textarea id="asset-notes" rows={2} maxLength={2000} value={notes} disabled={readOnly} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={submitting || !categoryId}>{t("common.save")}</Button>
          <Button type="button" variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
          {onDelete && (
            <Button type="button" variant="ghost" className="ml-auto text-destructive" disabled={submitting} onClick={onDelete}>
              {t("common.delete")}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

function AssetFigures({ asset }: { asset: FixedAssetResponse }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const figures: [string, string][] = [
    [t("assets.col.accumulated"), formatAmount(asset.accumulatedDepreciation)],
    [t("assets.col.bookValue"), formatAmount(asset.bookValue)],
    [t("assets.col.monthly"), formatAmount(asset.monthlyDepreciation)],
    [t("assets.lastDepreciated"), asset.lastDepreciatedPeriod ? formatMonth(asset.lastDepreciatedPeriod) : "—"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-4" data-testid="asset-figures">
      {figures.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="tnum text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DepreciationPlan({ lines }: { lines: DepreciationScheduleLineResponse[] }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const columns = useMemo<ColumnDef<DepreciationScheduleLineResponse>[]>(
    () => [
      { accessorKey: "period", header: t("assets.col.month"), cell: ({ getValue }) => formatMonth(getValue() as string) },
      { accessorKey: "amount", header: t("assets.col.depreciation"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "accumulated", header: t("assets.col.accumulated"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "bookValue", header: t("assets.col.bookValue"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      {
        accessorKey: "posted",
        header: t("assets.col.posted"),
        cell: ({ getValue }) => (getValue() ? <Badge variant="default">{t("assets.posted")}</Badge> : <span className="text-muted-foreground">{t("assets.planned")}</span>),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("assets.plan")}</h3>
      <DataGrid
        gridId="fixedAssetPlan"
        columns={columns}
        data={lines}
        rowCount={lines.length}
        getRowId={(l) => l.period}
        getRowClassName={(l) => (l.posted ? undefined : "text-muted-foreground")}
        emptyMessage={t("assets.planEmpty")}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={1200}
        pageSizeOptions={[1200]}
      />
    </section>
  );
}

function DisposeSection({ companyId, asset, onDisposed }: { companyId: string; asset: FixedAssetResponse; onDisposed: () => Promise<void> }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const confirm = useConfirm();
  const accounts = usePostableAccounts(companyId).data;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [proceeds, setProceeds] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dispose = useMutation({
    mutationFn: () => apiClient.disposeFixedAsset(companyId, asset.id, {
      date,
      proceeds: proceeds ? parseFloat(proceeds) : undefined,
      proceedsAccountId: proceeds && parseFloat(proceeds) > 0 ? accountId || undefined : undefined,
    }),
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "assets.disposed" }, { code: asset.code }));
      setOpen(false);
      await onDisposed();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("assets.saveError"))),
  });

  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{t("assets.dispose")}</Button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">{t("assets.dispose")}</h3>
      <p className="text-sm text-muted-foreground">{t("assets.disposeHint")}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label={t("assets.disposalDate")} htmlFor="asset-dispose-date" required>
          <Input id="asset-dispose-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label={t("assets.proceeds")} htmlFor="asset-dispose-proceeds">
          <Input id="asset-dispose-proceeds" type="number" min="0" step="0.01" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
        </FormField>
        <FormField label={t("assets.proceedsAccount")} htmlFor="asset-dispose-account">
          <SearchableSelect
            id="asset-dispose-account"
            value={accountId}
            onChange={setAccountId}
            disabled={!proceeds || parseFloat(proceeds) <= 0}
            options={accountOptions(accounts, ["10", "11"])}
            placeholder={t("assets.chooseAccount")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("common.noResults")}
          />
        </FormField>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={dispose.isPending}
          onClick={() => confirm(intl.formatMessage({ id: "assets.disposeConfirm" }, { code: asset.code, date: formatDisplayDate(date) }), () => {
            setError(null);
            dispose.mutate();
          }, { confirmLabel: t("assets.dispose"), destructive: true })}
        >
          {t("assets.disposePost")}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
      </div>
    </section>
  );
}
