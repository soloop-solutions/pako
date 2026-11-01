import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { BarcodeRuleResponse, RegisterResponse, StoreResponse } from "@pako/shared";
import { Copy, Plus } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { ShelfLabelsCard } from "@/pages/pos/ShelfLabels";
import { useMyAccess } from "@/hooks/useMyAccess";
import { posRegistersKey, posStoresKey, usePosRegisters, usePosStores } from "@/hooks/usePos";
import { useItemSearch, useWarehouses } from "@/hooks/useStock";
import { BARCODE_RULE_KINDS, BarcodeRuleKind, FiscalMode, REGISTER_PROFILES, barcodeRuleKindKey, fiscalModeKey, registerProfileKey } from "@/lib/pos-enums";

// docs/POS_PLAN.md §12: the shops (each an ATK branch) and their tills.
export function PosSetup() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const storesQuery = usePosStores();
  const registersQuery = usePosRegisters();
  const [editingStore, setEditingStore] = useState<StoreResponse | "new" | null>(null);
  const [editingRegister, setEditingRegister] = useState<RegisterResponse | "new" | null>(null);
  const [editingRule, setEditingRule] = useState<BarcodeRuleResponse | "new" | null>(null);
  const canEdit = canApprove("pos");
  // P2: how in-store 20–29 labels decode.
  const rulesQuery = useQuery({
    queryKey: ["posBarcodeRules", activeCompanyId],
    queryFn: () => apiClient.listPosBarcodeRules(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const ruleColumns = useMemo<ColumnDef<BarcodeRuleResponse>[]>(
    () => [
      {
        accessorKey: "prefix",
        header: t("pos.barcodeRule.prefix"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2 tabular-nums">
            {row.original.prefix}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { id: "kind", header: t("pos.barcodeRule.kind"), cell: ({ row }) => t(`pos.barcodeRule.kind.${barcodeRuleKindKey(row.original.kind)}`) },
      { accessorKey: "itemDigits", header: t("pos.barcodeRule.itemDigits"), meta: { numeric: true } },
      { accessorKey: "valueDigits", header: t("pos.barcodeRule.valueDigits"), meta: { numeric: true } },
      { accessorKey: "valueDecimals", header: t("pos.barcodeRule.valueDecimals"), meta: { numeric: true } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const storeColumns = useMemo<ColumnDef<StoreResponse>[]>(
    () => [
      { accessorKey: "code", header: t("pos.store.code") },
      {
        accessorKey: "name",
        header: t("pos.store.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "fiscalBranchNumber", header: t("pos.store.branch") },
      { accessorKey: "location", header: t("pos.store.location") },
      { accessorKey: "address", header: t("pos.store.address"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const registerColumns = useMemo<ColumnDef<RegisterResponse>[]>(
    () => [
      { accessorKey: "code", header: t("pos.register.code") },
      {
        accessorKey: "name",
        header: t("pos.register.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "storeName", header: t("pos.register.store") },
      { id: "profile", header: t("pos.register.profile"), cell: ({ row }) => t(`pos.register.profile.${registerProfileKey(row.original.profile)}`) },
      {
        id: "mode",
        header: t("pos.register.mode"),
        cell: ({ row }) => (
          <Badge variant={row.original.fiscalMode === FiscalMode.Training ? "secondary" : "default"}>
            {t(`pos.register.mode.${fiscalModeKey(row.original.fiscalMode)}`)}
          </Badge>
        ),
      },
      { accessorKey: "fiscalPosNumber", header: t("pos.register.posNumber") },
      {
        id: "certificate",
        header: t("pos.register.certificate"),
        cell: ({ row }) =>
          row.original.fiscalMode !== FiscalMode.Sef
            ? "—"
            : row.original.certificateNotAfter
              ? t("pos.register.certificate.until", { date: intl.formatDate(row.original.certificateNotAfter) })
              : <span className="text-destructive">{t("pos.register.certificate.missing")}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const stores = storesQuery.data ?? [];
  const registers = registersQuery.data ?? [];
  const rules = rulesQuery.data ?? [];

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: posStoresKey(activeCompanyId) });
    await queryClient.invalidateQueries({ queryKey: posRegistersKey(activeCompanyId) });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("pos.stores")}</CardTitle>
            <CardDescription>{t("nav.posSetup.description")}</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setEditingStore("new")}>
              <Plus className="size-4" />
              {t("pos.store.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-stores"
            columns={storeColumns}
            data={stores}
            rowCount={stores.length}
            isLoading={storesQuery.isPending}
            getRowId={(s) => s.id}
            getRowClassName={(s) => (s.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canEdit ? setEditingStore : undefined}
            emptyMessage={t("pos.store.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <CardTitle>{t("pos.registers")}</CardTitle>
          {canEdit && stores.length > 0 && (
            <Button size="sm" onClick={() => setEditingRegister("new")}>
              <Plus className="size-4" />
              {t("pos.register.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-registers"
            columns={registerColumns}
            data={registers}
            rowCount={registers.length}
            isLoading={registersQuery.isPending}
            getRowId={(r) => r.id}
            getRowClassName={(r) => (r.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canEdit ? setEditingRegister : undefined}
            emptyMessage={t("pos.register.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("pos.barcodeRules")}</CardTitle>
            <CardDescription>{t("pos.barcodeRules.description")}</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setEditingRule("new")}>
              <Plus className="size-4" />
              {t("pos.barcodeRule.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t("pos.barcodeRules.defaults")}</p>
          <DataGrid
            gridId="pos-barcode-rules"
            columns={ruleColumns}
            data={rules}
            rowCount={rules.length}
            isLoading={rulesQuery.isPending}
            getRowId={(r) => r.id}
            getRowClassName={(r) => (r.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canEdit ? setEditingRule : undefined}
            emptyMessage={t("pos.barcodeRules.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <ShelfLabelsCard />

      {editingRule && (
        <BarcodeRuleDialog
          rule={editingRule === "new" ? null : editingRule}
          onClose={() => setEditingRule(null)}
          onSaved={async () => {
            setEditingRule(null);
            await queryClient.invalidateQueries({ queryKey: ["posBarcodeRules", activeCompanyId] });
          }}
        />
      )}
      {editingStore && (
        <StoreDialog
          store={editingStore === "new" ? null : editingStore}
          onClose={() => setEditingStore(null)}
          onSaved={async () => {
            setEditingStore(null);
            await refresh();
          }}
        />
      )}
      {editingRegister && (
        <RegisterDialog
          register={editingRegister === "new" ? null : editingRegister}
          stores={stores.filter((s) => s.isActive || (editingRegister !== "new" && s.id === editingRegister.storeId))}
          onClose={() => setEditingRegister(null)}
          onSaved={async () => {
            setEditingRegister(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StoreDialog({ store, onClose, onSaved }: { store: StoreResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const warehouses = (useWarehouses().data ?? []).filter((w) => w.isActive || w.id === store?.warehouseId);
  const priceLists = useQuery({
    queryKey: ["priceLists", activeCompanyId],
    queryFn: () => apiClient.listPriceLists(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? [];
  const [code, setCode] = useState(store?.code ?? "");
  const [name, setName] = useState(store?.name ?? "");
  const [address, setAddress] = useState(store?.address ?? "");
  const [branch, setBranch] = useState(String(store?.fiscalBranchNumber ?? 1));
  const [location, setLocation] = useState(store?.location ?? "");
  const [warehouseId, setWarehouseId] = useState(store?.warehouseId ?? warehouses.find((w) => w.isDefault)?.id ?? "");
  const [priceListId, setPriceListId] = useState(store?.priceListId ?? "");
  const [header, setHeader] = useState(store?.receiptHeader ?? "");
  const [footer, setFooter] = useState(store?.receiptFooter ?? "");
  const [isActive, setIsActive] = useState(store?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  // P4/P5: the item a hotel stay's tourist tax is charged with; P4: the online booking link.
  const [touristTaxItemId, setTouristTaxItemId] = useState(store?.touristTaxItemId ?? "");
  const [bookingToken, setBookingToken] = useState<string | null>(store?.bookingToken ?? null);
  const [copied, setCopied] = useState(false);
  const itemSearch = useItemSearch();
  const taxItemKnown = !touristTaxItemId || itemSearch.items.some((i) => i.id === touristTaxItemId);
  const savedTaxItem = useQuery({
    queryKey: ["items", activeCompanyId, "one", touristTaxItemId],
    queryFn: () => apiClient.itemsGET2(activeCompanyId as string, touristTaxItemId),
    enabled: !!activeCompanyId && !taxItemKnown,
  }).data;
  const taxItemOptions = useMemo(() => {
    const options = itemSearch.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
    if (savedTaxItem && !options.some((o) => o.value === savedTaxItem.id)) options.unshift({ value: savedTaxItem.id, label: `${savedTaxItem.code} · ${savedTaxItem.name}` });
    return options;
  }, [itemSearch.items, savedTaxItem]);
  const bookingLink = useMutation({
    mutationFn: (enabled: boolean) => apiClient.setPosBookingLink(activeCompanyId as string, (store as StoreResponse).id, enabled),
    onSuccess: (token) => {
      setError(null);
      setCopied(false);
      setBookingToken(token || null);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const bookingUrl = bookingToken ? `${window.location.origin}/book/${bookingToken}` : "";
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: code.trim(), name: name.trim(), address: address.trim() || undefined, fiscalBranchNumber: Number(branch),
        location: location.trim(), warehouseId: warehouseId || (warehouses.find((w) => w.isDefault)?.id ?? ""),
        priceListId: priceListId || undefined, receiptHeader: header.trim() || undefined, receiptFooter: footer.trim() || undefined, isActive,
        // Kept as it is: this dialog doesn't edit the tips account.
        tipsAccountId: store?.tipsAccountId,
        touristTaxItemId: touristTaxItemId || undefined,
      };
      return store
        ? apiClient.updatePosStore(activeCompanyId as string, store.id, body)
        : apiClient.createPosStore(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={store ? store.name : t("pos.store.new")}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert error={error} />
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field id="st-code" label={t("pos.store.code")}>
            <Input id="st-code" required maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field id="st-name" label={t("pos.store.name")}>
            <Input id="st-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="st-branch" label={t("pos.store.branch")} hint={t("pos.store.branch.hint")}>
            <Input id="st-branch" type="number" min={1} required value={branch} onChange={(e) => setBranch(e.target.value)} />
          </Field>
          <Field id="st-location" label={t("pos.store.location")}>
            <Input id="st-location" required maxLength={60} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        <Field id="st-address" label={t("pos.store.address")}>
          <Input id="st-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="st-wh" label={t("pos.store.warehouse")}>
            <Select
              id="st-wh"
              value={warehouseId}
              onValueChange={setWarehouseId}
              options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
            />
          </Field>
          <Field id="st-pl" label={t("pos.store.priceList")}>
            <Select
              id="st-pl"
              value={priceListId}
              onValueChange={setPriceListId}
              options={[
                { value: "", label: t("pos.store.priceList.none") },
                ...priceLists.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </Field>
        </div>
        <Field id="st-header" label={t("pos.store.header")}>
          <Textarea id="st-header" rows={2} value={header} onChange={(e) => setHeader(e.target.value)} />
        </Field>
        <Field id="st-footer" label={t("pos.store.footer")}>
          <Textarea id="st-footer" rows={2} value={footer} onChange={(e) => setFooter(e.target.value)} />
        </Field>
        <Field id="st-tourist-tax" label={t("svc.store.touristTaxItem")} hint={t("svc.store.touristTaxItem.hint")}>
          <SearchableSelect
            id="st-tourist-tax"
            value={touristTaxItemId}
            onChange={setTouristTaxItemId}
            onSearchChange={itemSearch.onSearchChange}
            placeholder={t("svc.store.touristTaxItem.none")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("common.noResults")}
            emptyOptionLabel={t("svc.store.touristTaxItem.none")}
            options={taxItemOptions}
          />
        </Field>
        {store && (
          <div className="flex flex-col gap-1 rounded-md border p-2" data-testid="booking-link">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!bookingToken}
                disabled={bookingLink.isPending}
                onChange={(e) => bookingLink.mutate(e.target.checked)}
              />
              {t("svc.store.onlineBooking")}
            </label>
            <p className="text-xs text-muted-foreground">{t("svc.store.onlineBooking.hint")}</p>
            {bookingUrl && (
              <div className="flex items-center gap-2">
                <Input readOnly value={bookingUrl} aria-label={t("svc.store.onlineBooking.link")} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(bookingUrl).then(() => setCopied(true), () => setCopied(false));
                  }}
                >
                  <Copy className="size-4" /> {copied ? t("svc.store.onlineBooking.copied") : t("svc.store.onlineBooking.copy")}
                </Button>
              </div>
            )}
          </div>
        )}
        {store && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("common.active")}
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

function RegisterDialog({ register, stores, onClose, onSaved }: {
  register: RegisterResponse | null;
  stores: StoreResponse[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const accounts = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => apiClient.accountsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? [];
  const [storeId, setStoreId] = useState(register?.storeId ?? stores[0]?.id ?? "");
  const [code, setCode] = useState(register?.code ?? "");
  const [name, setName] = useState(register?.name ?? "");
  const [profile, setProfile] = useState(String(register?.profile ?? 0));
  const [mode, setMode] = useState(String(register?.fiscalMode ?? FiscalMode.Training));
  const [posNumber, setPosNumber] = useState(String(register?.fiscalPosNumber ?? 1));
  const [fiscalizationNo, setFiscalizationNo] = useState(register?.fiscalizationNumber ?? "");
  const [cashAccountId, setCashAccountId] = useState(register?.cashAccountId ?? "");
  const [isActive, setIsActive] = useState(register?.isActive ?? true);
  const [certificate, setCertificate] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A new register that was created but whose certificate failed to save: a retry updates it
  // instead of creating it a second time (which the unique code would refuse).
  const [createdId, setCreatedId] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        storeId, code: code.trim(), name: name.trim(), profile: Number(profile), fiscalMode: Number(mode),
        fiscalPosNumber: Number(posNumber), cashAccountId, fiscalizationNumber: fiscalizationNo.trim() || undefined, isActive,
      };
      const existingId = register?.id ?? createdId;
      const saved = existingId
        ? await apiClient.updatePosRegister(activeCompanyId as string, existingId, body)
        : await apiClient.createPosRegister(activeCompanyId as string, body);
      if (!existingId) setCreatedId(saved.id);
      if (certificate.trim())
        await apiClient.savePosRegisterCertificate(activeCompanyId as string, saved.id, { certificatePem: certificate.trim() });
      return saved;
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  // Leaving after a half-done create still has to show the new register in the list.
  const dismiss = createdId ? onSaved : onClose;

  return (
    <FormDialog open onOpenChange={(open) => !open && dismiss()} title={register ? register.name : t("pos.register.new")}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert error={error} />
        <Field id="rg-store" label={t("pos.register.store")}>
          <Select id="rg-store" value={storeId} onValueChange={setStoreId} options={stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
        </Field>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field id="rg-code" label={t("pos.register.code")}>
            <Input id="rg-code" required maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field id="rg-name" label={t("pos.register.name")}>
            <Input id="rg-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rg-profile" label={t("pos.register.profile")}>
            <Select
              id="rg-profile"
              value={profile}
              onValueChange={setProfile}
              options={REGISTER_PROFILES.map((p) => ({ value: String(p), label: t(`pos.register.profile.${registerProfileKey(p)}`) }))}
            />
          </Field>
          <Field id="rg-mode" label={t("pos.register.mode")}>
            <Select
              id="rg-mode"
              value={mode}
              onValueChange={setMode}
              options={[FiscalMode.Training, FiscalMode.Sef, FiscalMode.Pef].map((m) => ({ value: String(m), label: t(`pos.register.mode.${fiscalModeKey(m)}`) }))}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rg-pos" label={t("pos.register.posNumber")} hint={t("pos.register.posNumber.hint")}>
            <Input id="rg-pos" type="number" min={1} required value={posNumber} onChange={(e) => setPosNumber(e.target.value)} />
          </Field>
          <Field id="rg-edi" label={t("pos.register.fiscalizationNo")}>
            <Input id="rg-edi" maxLength={40} value={fiscalizationNo} onChange={(e) => setFiscalizationNo(e.target.value)} />
          </Field>
        </div>
        <Field id="rg-cash" label={t("pos.register.cashAccount")}>
          <SearchableSelect
            id="rg-cash"
            value={cashAccountId}
            onChange={setCashAccountId}
            options={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
          />
        </Field>
        {Number(mode) === FiscalMode.Sef && (
          <Field id="rg-cert" label={t("pos.register.certificate")} hint={t("pos.register.certificate.hint")}>
            {register?.certificateNotAfter && (
              <p className="text-sm">{intl.formatMessage({ id: "pos.register.certificate.until" }, { date: intl.formatDate(register.certificateNotAfter) })}</p>
            )}
            <Textarea
              id="rg-cert"
              rows={4}
              className="font-mono text-xs"
              placeholder="-----BEGIN CERTIFICATE-----"
              value={certificate}
              onChange={(e) => setCertificate(e.target.value)}
            />
          </Field>
        )}
        {register && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("common.active")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={dismiss}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !storeId || !cashAccountId}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function BarcodeRuleDialog({ rule, onClose, onSaved }: { rule: BarcodeRuleResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [prefix, setPrefix] = useState(rule?.prefix ?? "");
  const [kind, setKind] = useState(String(rule?.kind ?? BarcodeRuleKind.Weight));
  const [itemDigits, setItemDigits] = useState(String(rule?.itemDigits ?? 5));
  const [valueDigits, setValueDigits] = useState(String(rule?.valueDigits ?? 5));
  const [decimals, setDecimals] = useState(String(rule?.valueDecimals ?? 3));
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  // An EAN-13 label: 2 prefix digits, the item and the value, 1 check digit.
  const digitsOk = Number(itemDigits) + Number(valueDigits) === 10;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        prefix: prefix.trim(), kind: Number(kind), itemDigits: Number(itemDigits), valueDigits: Number(valueDigits),
        valueDecimals: Number(decimals), isActive,
      };
      return rule
        ? apiClient.updatePosBarcodeRule(activeCompanyId as string, rule.id, body)
        : apiClient.createPosBarcodeRule(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!digitsOk) {
      setError(t("pos.barcodeRule.digitsInvalid"));
      return;
    }
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={rule ? t("pos.barcodeRule.edit", { prefix: rule.prefix }) : t("pos.barcodeRule.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field id="br-prefix" label={t("pos.barcodeRule.prefix")} hint={t("pos.barcodeRule.prefix.hint")}>
            <Input id="br-prefix" required inputMode="numeric" pattern="2[0-9]" maxLength={2} value={prefix} onChange={(e) => setPrefix(e.target.value)} className="tabular-nums" />
          </Field>
          <Field id="br-kind" label={t("pos.barcodeRule.kind")}>
            <Select
              id="br-kind"
              value={kind}
              onValueChange={setKind}
              options={BARCODE_RULE_KINDS.map((k) => ({ value: String(k), label: t(`pos.barcodeRule.kind.${barcodeRuleKindKey(k)}`) }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field id="br-item" label={t("pos.barcodeRule.itemDigits")}>
            <Input id="br-item" type="number" min={1} max={9} required value={itemDigits} onChange={(e) => setItemDigits(e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field id="br-value" label={t("pos.barcodeRule.valueDigits")}>
            <Input id="br-value" type="number" min={1} max={9} required value={valueDigits} onChange={(e) => setValueDigits(e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field id="br-decimals" label={t("pos.barcodeRule.valueDecimals")}>
            <Input id="br-decimals" type="number" min={0} max={5} required value={decimals} onChange={(e) => setDecimals(e.target.value)} className="text-right tabular-nums" />
          </Field>
        </div>
        <p className={digitsOk ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{t("pos.barcodeRule.digits.hint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
