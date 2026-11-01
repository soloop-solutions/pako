import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SaveSiteRequest, SiteResponse } from "@pako/shared";
import { ArrowLeft, Plus, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useConstructionSite, vxKeys } from "@/hooks/useVerticals";
import { SITE_STATES, SiteState } from "@/lib/verticals-enums";
import { ProgressBillsTab } from "@/pages/construction/ProgressBillsTab";
import { SiteCostsTab } from "@/pages/construction/SiteCostsTab";
import { SiteMaterialsTab } from "@/pages/construction/SiteMaterialsTab";
import { ErrorAlert, Field, ItemField, PartnerField, SiteStateBadge, TabBar } from "@/pages/verticals/shared";
import { amount, gridKeyDown, parseNum, useT } from "@/pages/verticals/verticals-utils";

interface CostCodeRow { code: string; name: string; budget: string }
interface BoqRow { code: string; description: string; unit: string; quantity: string; unitPrice: string }

const emptyCostCode = (): CostCodeRow => ({ code: "", name: "", budget: "" });
const emptyBoq = (): BoqRow => ({ code: "", description: "", unit: "", quantity: "", unitPrice: "" });

// docs/ERP_VERTICALS_PLAN.md §1 — one construction site: its contract, cost codes and bill of
// quantities (paramasë), progress bills (situacione), costs and completion, materials issued to it.
export function SiteDetail() {
  const t = useT();
  const { id } = useParams();
  const isNew = id === "new";
  const { activeCompanyId } = useCompany();
  const siteQuery = useConstructionSite(id);
  const site = siteQuery.data;
  const [tab, setTab] = useUrlParam("tab", "overview");

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  const tabs = [
    { id: "overview", label: t("vx.site.tab.overview") },
    { id: "bills", label: t("vx.site.tab.bills") },
    { id: "costs", label: t("vx.site.tab.costs") },
    { id: "materials", label: t("vx.site.tab.materials") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="xs" variant="ghost">
          <Link to="/construction"><ArrowLeft className="size-3.5" />{t("vx.nav.sites")}</Link>
        </Button>
        <h2 className="text-xl font-semibold">{isNew ? t("vx.site.new") : site ? `${site.projectCode} · ${site.name}` : t("common.loading")}</h2>
        {site && <SiteStateBadge state={site.state} />}
      </div>
      {!isNew && <TabBar tabs={tabs} value={tab} onChange={setTab} label={t("vx.nav.sites")} />}
      <div role={isNew ? undefined : "tabpanel"}>
        {isNew || tab === "overview" ? (
          isNew || site ? <SiteOverview site={site} /> : null
        ) : !site ? null : tab === "bills" ? (
          <ProgressBillsTab site={site} />
        ) : tab === "costs" ? (
          <SiteCostsTab site={site} />
        ) : (
          <SiteMaterialsTab site={site} />
        )}
      </div>
    </div>
  );
}

function SiteOverview({ site }: { site: SiteResponse | undefined }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const editable = canWrite("sales");
  const [name, setName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [clientPartnerId, setClientPartnerId] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [retentionPercent, setRetentionPercent] = useState("0");
  const [billingItemId, setBillingItemId] = useState("");
  const [address, setAddress] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [state, setState] = useState<number>(SiteState.Tender);
  const [costCodes, setCostCodes] = useState<CostCodeRow[]>([emptyCostCode()]);
  const [boq, setBoq] = useState<BoqRow[]>([emptyBoq()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!site) return;
    setName(site.name);
    setProjectCode(site.projectCode);
    setClientPartnerId(site.clientPartnerId);
    setContractValue(String(site.contractValue));
    setRetentionPercent(String(site.retentionPercent));
    setBillingItemId(site.billingItemId);
    setAddress(site.address ?? "");
    setStartDate(site.startDate ?? "");
    setEndDate(site.endDate ?? "");
    setState(site.state);
    setCostCodes(site.costCodes.length ? site.costCodes.map((c) => ({ code: c.code, name: c.name, budget: String(c.budget) })) : [emptyCostCode()]);
    setBoq(site.boq.length ? site.boq.map((b) => ({ code: b.code, description: b.description, unit: b.unit, quantity: String(b.quantity), unitPrice: String(b.unitPrice) })) : [emptyBoq()]);
  }, [site]);

  function request(): SaveSiteRequest {
    return {
      name: name.trim(),
      clientPartnerId,
      contractValue: parseNum(contractValue) || 0,
      retentionPercent: parseNum(retentionPercent) || 0,
      billingItemId,
      costCodes: costCodes.filter((c) => c.code.trim()).map((c) => ({ code: c.code.trim(), name: c.name.trim(), budget: parseNum(c.budget) || 0 })),
      boq: boq.filter((b) => b.code.trim()).map((b) => ({
        code: b.code.trim(), description: b.description.trim(), unit: b.unit.trim(), quantity: parseNum(b.quantity) || 0, unitPrice: parseNum(b.unitPrice) || 0,
      })),
      projectCode: site ? undefined : projectCode.trim(),
      address: address.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      state,
    };
  }

  const save = useMutation({
    mutationFn: () => (site
      ? apiClient.updateConstructionSite(activeCompanyId as string, site.id, request())
      : apiClient.createConstructionSite(activeCompanyId as string, request())),
    onSuccess: async (saved) => {
      queryClient.setQueryData(vxKeys.site(activeCompanyId, saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: vxKeys.sites(activeCompanyId) });
      if (!site) navigate(`/construction/${saved.id}`, { replace: true });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.site.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clientPartnerId) return setError(t("vx.site.clientRequired"));
    if (!billingItemId) return setError(t("vx.site.billingItemRequired"));
    save.mutate();
  }

  const setCode = (i: number, patch: Partial<CostCodeRow>) => setCostCodes((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setLine = (i: number, patch: Partial<BoqRow>) => setBoq((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const savedBoq = (code: string) => site?.boq.find((b) => b.code === code.trim());

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <ErrorAlert error={error} />
      <Card>
        <CardHeader>
          <CardTitle>{t("vx.site.details")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="site-name" label={t("vx.site.name")} className="lg:col-span-2">
            <Input id="site-name" required maxLength={160} value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="site-project" label={t("vx.site.projectCode")} hint={site ? undefined : t("vx.site.projectCodeHint")}>
            <Input id="site-project" required={!site} maxLength={20} value={projectCode} disabled={!!site || !editable} onChange={(e) => setProjectCode(e.target.value)} />
          </Field>
          <Field id="site-state" label={t("vx.state")}>
            <Select id="site-state" value={String(state)} disabled={!editable} onValueChange={(v) => setState(Number(v))}
              options={SITE_STATES.map((s) => ({ value: String(s), label: t(`vx.siteState.${s}`) }))} />
          </Field>
          <PartnerField id="site-client" label={t("vx.site.client")} role="customer" value={clientPartnerId} onChange={setClientPartnerId}
            disabled={!editable} fallbackLabel={site?.clientName} />
          <ItemField id="site-billing-item" label={t("vx.site.billingItem")} hint={t("vx.site.billingItemHint")} value={billingItemId}
            onChange={setBillingItemId} disabled={!editable} />
          <Field id="site-contract" label={t("vx.site.contractValueNet")}>
            <Input id="site-contract" inputMode="decimal" className="text-right tnum" required value={contractValue} disabled={!editable}
              onChange={(e) => setContractValue(e.target.value)} />
          </Field>
          <Field id="site-retention" label={t("vx.site.retentionPercent")}>
            <Input id="site-retention" inputMode="decimal" className="text-right tnum" value={retentionPercent} disabled={!editable}
              onChange={(e) => setRetentionPercent(e.target.value)} />
          </Field>
          <Field id="site-address" label={t("vx.address")} className="lg:col-span-2">
            <Input id="site-address" value={address} disabled={!editable} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field id="site-start" label={t("vx.site.startDate")}>
            <Input id="site-start" type="date" value={startDate} disabled={!editable} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field id="site-end" label={t("vx.site.endDate")}>
            <Input id="site-end" type="date" value={endDate} disabled={!editable} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("vx.costCodes")}</CardTitle>
          <CardDescription>{t("vx.costCodes.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1" data-edit-grid>
          <div className="grid grid-cols-[8rem_minmax(12rem,1fr)_9rem_2.25rem] gap-2 text-xs font-medium text-muted-foreground">
            <span>{t("common.code")}</span><span>{t("common.name")}</span><span className="text-right">{t("vx.budget")}</span><span />
          </div>
          {costCodes.map((row, i) => (
            <div key={i} className="grid grid-cols-[8rem_minmax(12rem,1fr)_9rem_2.25rem] items-center gap-2" data-testid="cost-code-row">
              <Input className="h-7" aria-label={t("common.code")} value={row.code} disabled={!editable} data-row={i} data-col="code"
                onKeyDown={gridKeyDown} onChange={(e) => setCode(i, { code: e.target.value })} />
              <Input className="h-7" aria-label={t("common.name")} value={row.name} disabled={!editable} data-row={i} data-col="name"
                onKeyDown={gridKeyDown} onChange={(e) => setCode(i, { name: e.target.value })} />
              <Input className="h-7 text-right tnum" inputMode="decimal" aria-label={t("vx.budget")} value={row.budget} disabled={!editable}
                data-row={i} data-col="budget" onKeyDown={gridKeyDown} onChange={(e) => setCode(i, { budget: e.target.value })} />
              {editable ? (
                <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t("common.remove")}
                  onClick={() => setCostCodes((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyCostCode()]))}>
                  <X className="size-3.5" />
                </Button>
              ) : <span />}
            </div>
          ))}
          {editable && (
            <Button type="button" size="xs" variant="ghost" className="w-fit" onClick={() => setCostCodes((rows) => [...rows, emptyCostCode()])}>
              <Plus className="size-3.5" />{t("vx.costCodes.add")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("vx.boq")}</CardTitle>
            <CardDescription>{t("vx.boq.hint")}</CardDescription>
          </div>
          {site && (
            <div className="text-right text-sm">
              <div className="text-xs text-muted-foreground">{t("vx.boq.total")}</div>
              <div className="font-semibold tnum" data-testid="boq-total">{amount(site.boqTotal)}</div>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-1 overflow-x-auto" data-edit-grid>
          <div className="grid min-w-[52rem] grid-cols-[6rem_minmax(14rem,1fr)_5rem_7rem_7rem_7rem_7rem_2.25rem] gap-2 text-xs font-medium text-muted-foreground">
            <span>{t("common.code")}</span><span>{t("common.description")}</span><span>{t("vx.unit")}</span>
            <span className="text-right">{t("common.quantity")}</span><span className="text-right">{t("vx.unitPrice")}</span>
            <span className="text-right">{t("common.amount")}</span><span className="text-right">{t("vx.boq.certified")}</span><span />
          </div>
          {boq.map((row, i) => {
            const saved = savedBoq(row.code);
            return (
              <div key={i} className="grid min-w-[52rem] grid-cols-[6rem_minmax(14rem,1fr)_5rem_7rem_7rem_7rem_7rem_2.25rem] items-center gap-2" data-testid="boq-row">
                <Input className="h-7" aria-label={t("common.code")} value={row.code} disabled={!editable} data-row={i} data-col="code"
                  onKeyDown={gridKeyDown} onChange={(e) => setLine(i, { code: e.target.value })} />
                <Input className="h-7" aria-label={t("common.description")} value={row.description} disabled={!editable} data-row={i} data-col="desc"
                  onKeyDown={gridKeyDown} onChange={(e) => setLine(i, { description: e.target.value })} />
                <Input className="h-7" aria-label={t("vx.unit")} value={row.unit} disabled={!editable} data-row={i} data-col="unit"
                  onKeyDown={gridKeyDown} onChange={(e) => setLine(i, { unit: e.target.value })} />
                <Input className="h-7 text-right tnum" inputMode="decimal" aria-label={t("common.quantity")} value={row.quantity} disabled={!editable}
                  data-row={i} data-col="qty" onKeyDown={gridKeyDown} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                <Input className="h-7 text-right tnum" inputMode="decimal" aria-label={t("vx.unitPrice")} value={row.unitPrice} disabled={!editable}
                  data-row={i} data-col="price" onKeyDown={gridKeyDown} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                <span className="text-right text-sm tnum">{saved ? amount(saved.amount) : "—"}</span>
                <span className="text-right text-sm tnum">{saved ? saved.certified : "—"}</span>
                {editable ? (
                  <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t("common.remove")}
                    onClick={() => setBoq((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyBoq()]))}>
                    <X className="size-3.5" />
                  </Button>
                ) : <span />}
              </div>
            );
          })}
          {editable && (
            <Button type="button" size="xs" variant="ghost" className="w-fit" onClick={() => setBoq((rows) => [...rows, emptyBoq()])}>
              <Plus className="size-3.5" />{t("vx.boq.add")}
            </Button>
          )}
        </CardContent>
      </Card>

      {editable && (
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>{save.isPending ? t("common.saving") : t("common.save")}</Button>
        </div>
      )}
    </form>
  );
}
