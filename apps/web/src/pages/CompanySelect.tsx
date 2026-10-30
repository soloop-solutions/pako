import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { CompanyResponse } from "@pako/shared";
import { Building2, LayoutGrid, List, LogOut, Plus, Search, ShieldCheck } from "lucide-react";
import { useIntl } from "react-intl";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggleButton } from "@/components/layout/ThemeToggleButton";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useAccount } from "@/hooks/useAccount";
import { getLastOpenedMap } from "@/lib/company-last-opened";
import { emptyProfileValues, toProfileRequest, type CompanyProfileValues } from "@/lib/company-profile";
import { cn } from "@/lib/utils";
import { CompanyProfileFields } from "@/pages/shared/CompanyProfileFields";

type View = "grid" | "list";
const VIEW_KEY = "pako.lobby.view";

function storedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

// The lobby: where a signed-in user picks the company to work in, and the only place a company is
// changed or created. Inside the app there is no switcher — "Exit to lobby" in the header brings
// the user back here. Entering the lobby leaves the current company.
export function CompanySelect() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { auth, logout } = useAuth();
  const { companies, loading, activeCompanyId, setActiveCompanyId, leaveCompany, companiesOpenElsewhere, replacedBy, clearReplacedNotice } = useCompany();
  const [conflict, setConflict] = useState<{ target: CompanyResponse; openName: string; unsaved: boolean } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(storedView);
  const [creating, setCreating] = useState(false);
  const account = useAccount();
  // docs/PLATFORM_ADMIN.md: each accountant may create as many companies as the administrator allows.
  const limit = account.data?.companyLimit;
  const created = account.data?.companiesCreated ?? 0;
  const atLimit = limit != null && created >= limit;

  useEffect(() => {
    if (activeCompanyId) leaveCompany();
    // Only on arrival: being in the lobby means being in no company.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A remembered view is a convenience only.
    }
  }

  const lastOpened = useMemo(() => (auth ? getLastOpenedMap(auth.userId) : {}), [auth]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies
      .filter((c) => !c.isArchived)
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.businessNumber ?? "").toLowerCase().includes(q) ||
          (c.tradingName ?? "").toLowerCase().includes(q) ||
          (c.municipality ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const la = lastOpened[a.id] ?? "";
        const lb = lastOpened[b.id] ?? "";
        return la !== lb ? lb.localeCompare(la) : a.name.localeCompare(b.name);
      });
  }, [companies, query, lastOpened]);

  function enter(company: CompanyResponse) {
    // Nothing from the previous company may leak into the next one.
    queryClient.clear();
    setConflict(null);
    clearReplacedNotice();
    setActiveCompanyId(company.id);
    navigate("/dashboard", { replace: true });
  }

  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? t("lobby.anotherCompany");

  // Only one company may be open at a time: if another tab or window has a different company open,
  // ask first — opening this one closes that one there.
  async function open(company: CompanyResponse) {
    if (checking) return;
    setChecking(company.id);
    try {
      const other = (await companiesOpenElsewhere()).find((o) => o.companyId !== company.id);
      if (other) setConflict({ target: company, openName: nameOf(other.companyId), unsaved: other.unsaved });
      else enter(company);
    } finally {
      setChecking(null);
    }
  }

  const lastOpenedLabel = (id: string) =>
    lastOpened[id] ? intl.formatDate(new Date(lastOpened[id]), { dateStyle: "medium" }) : t("lobby.neverOpened");

  const columns = useMemo<ColumnDef<CompanyResponse>[]>(
    () => [
      { accessorKey: "name", header: t("companies.companyName") },
      { accessorKey: "tradingName", header: t("lobby.tradingName"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "businessNumber", header: t("companySelect.businessNumber"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "municipality", header: t("companySelect.municipality"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { id: "lastOpened", header: t("lobby.lastOpened"), accessorFn: (c) => lastOpened[c.id] ?? "", cell: ({ row }) => lastOpenedLabel(row.original.id) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, lastOpened],
  );

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-6">
        <span className="text-sm font-semibold text-primary">PAKO</span>
        <div className="flex items-center gap-3">
          <ThemeToggleButton />
          <LanguageSwitcher />
          {account.data?.isPlatformAdmin && (
            <Button variant="outline" size="sm" onClick={() => navigate("/platform")}>
              <ShieldCheck className="size-4" />
              {t("platform.title")}
            </Button>
          )}
          <span className="text-sm text-muted-foreground">{auth?.email}</span>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="size-4" />
            {t("common.logOut")}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t("lobby.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("lobby.subtitle")}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => setCreating(true)} disabled={atLimit || account.isPending}>
              <Plus className="size-4" />
              {t("lobby.newCompany")}
            </Button>
            {limit != null && (
              <span className={cn("text-xs", atLimit ? "text-destructive" : "text-muted-foreground")}>
                {t(atLimit ? "lobby.limitReached" : "lobby.limitUsage", { used: String(created), limit: String(limit) })}
              </span>
            )}
          </div>
        </div>

        {replacedBy && (
          <Alert className="mb-4">
            <AlertDescription className="flex items-start justify-between gap-3">
              <span>
                {t("lobby.replaced", { closed: nameOf(replacedBy.closedId), opened: nameOf(replacedBy.openedId) })}
                {replacedBy.lostUnsaved && ` ${t("lobby.replacedUnsaved")}`}
              </span>
              <button type="button" className="text-xs underline" onClick={clearReplacedNotice}>
                {t("dashboard.suggest.dismiss")}
              </button>
            </AlertDescription>
          </Alert>
        )}

        {loading && companies.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">{t("companies.loadingCompanies")}</p>
        ) : companies.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center">
            <Building2 className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="mb-4 text-sm text-muted-foreground">{t("lobby.noCompanies")}</p>
            {atLimit ? (
              <p className="text-sm text-muted-foreground">{t("lobby.noCompaniesAllowed")}</p>
            ) : (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {t("lobby.createFirst")}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-60 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("companySelect.search")}
                  aria-label={t("companySelect.search")}
                  className="pl-10"
                />
              </div>
              <div className="inline-flex rounded-md border bg-card p-0.5" role="radiogroup" aria-label={t("lobby.view")}>
                {(["grid", "list"] as const).map((v) => {
                  const Icon = v === "grid" ? LayoutGrid : List;
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={view === v}
                      aria-label={t(`lobby.view.${v}`)}
                      title={t(`lobby.view.${v}`)}
                      onClick={() => changeView(v)}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[12.5px] font-medium",
                        view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {t(`lobby.view.${v}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("common.noResults")}</p>
            ) : view === "grid" ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((company) => (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => void open(company)}
                    disabled={checking !== null}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border bg-card p-4 text-left transition-colors",
                      "hover:border-primary/40 hover:bg-primary/5",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 shrink-0 text-primary" />
                      <span className="truncate text-sm font-semibold">{company.name}</span>
                    </div>
                    {company.tradingName && company.tradingName !== company.name && (
                      <span className="pl-6 text-xs text-muted-foreground">{company.tradingName}</span>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-6 text-xs text-muted-foreground">
                      {company.businessNumber && (
                        <span>
                          {t("companySelect.businessNumber")}: {company.businessNumber}
                        </span>
                      )}
                      {company.municipality && (
                        <span>
                          {t("companySelect.municipality")}: {company.municipality}
                        </span>
                      )}
                    </div>
                    <span className="mt-2 pl-6 text-xs text-muted-foreground">
                      {t("lobby.lastOpened")}: {lastOpenedLabel(company.id)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <DataGrid
                gridId="lobby-companies"
                columns={columns}
                data={filtered}
                rowCount={filtered.length}
                getRowId={(row) => row.id}
                onRowClick={(company) => void open(company)}
                manualFiltering={false}
                manualSorting={false}
                manualGrouping={false}
              />
            )}
          </>
        )}
      </main>

      <NewCompanyDialog open={creating} onClose={() => setCreating(false)} onCreated={(company) => void open(company)} />

      <Dialog open={conflict !== null} onOpenChange={(next) => !next && setConflict(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("lobby.oneAtATime.title")}</DialogTitle>
            <DialogDescription>
              {conflict && t("lobby.oneAtATime.message", { open: conflict.openName, target: conflict.target.name })}
            </DialogDescription>
            {conflict?.unsaved && (
              <p className="rounded-md border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground" role="alert">
                {t("lobby.oneAtATime.unsaved", { open: conflict.openName })}
              </p>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => conflict && enter(conflict.target)}>
              {conflict && t("lobby.oneAtATime.confirm", { target: conflict.target.name })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// "New company" asks for the same details as Settings → Company profile, plus whether the company
// is VAT-registered (it shapes the tax setup, so it is chosen at creation) and, for accounting
// firms, which firm it belongs to.
function NewCompanyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (company: CompanyResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { createCompany } = useCompany();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<CompanyProfileValues>(emptyProfileValues);
  const [vatRegistered, setVatRegistered] = useState(true);
  const [firmId, setFirmId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const firmsQuery = useQuery({ queryKey: ["firms"], queryFn: () => apiClient.firmsAll(), enabled: open });

  function reset() {
    setValues(emptyProfileValues());
    setVatRegistered(true);
    setFirmId("");
    setError(null);
    setDirty(false);
    setSaving(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { company, profileError } = await createCompany(values.name.trim(), firmId || undefined, {
        isVatRegistered: vatRegistered,
        profile: toProfileRequest(values),
      });
      void queryClient.invalidateQueries({ queryKey: ["account"] });
      if (profileError) {
        // The company exists; only the details failed. Open it and say where to finish them.
        toast.error(getApiErrorMessage(profileError, t("lobby.detailsNotSaved")));
      }
      reset();
      onCreated(company);
    } catch (err) {
      setError(getApiErrorMessage(err, t("companies.createError")));
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t("companies.createCompany")}
      description={t("companies.createCompanyDescription")}
      size="lg"
      dirty={dirty}
    >
      <form className="flex flex-col gap-5" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {(firmsQuery.data?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2 sm:max-w-sm">
            <Label htmlFor="nc-firm">{t("companies.firmOptional")}</Label>
            <SearchableSelect
              id="nc-firm"
              value={firmId}
              onChange={(v) => {
                setFirmId(v);
                setDirty(true);
              }}
              placeholder={t("companies.directCompany")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              emptyOptionLabel={t("companies.directCompany")}
              options={(firmsQuery.data ?? []).map((firm) => ({ value: firm.id, label: firm.name }))}
            />
          </div>
        )}
        <CompanyProfileFields
          idPrefix="nc"
          variant="plain"
          values={values}
          onChange={(patch) => {
            setValues((v) => ({ ...v, ...patch }));
            setDirty(true);
          }}
          vatRegistered={vatRegistered}
          onVatRegisteredChange={(v) => {
            setVatRegistered(v);
            setDirty(true);
          }}
          currency="EUR"
        />
        <div className="sticky bottom-0 -mx-6 -mb-6 flex justify-end gap-2 border-t bg-background px-6 py-3">
          <Button type="button" variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={saving || values.name.trim().length === 0}>
            {saving ? t("companies.creating") : t("lobby.createAndOpen")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
