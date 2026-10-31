import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Lightbulb, Settings2, X } from "lucide-react";
import type { DashboardLayoutResponse, DashboardWidgetConfig } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";
import { canShow, newWidget, suggestionsFor, widgetDef, type Suggestion } from "@/pages/dashboard/catalog";
import { DashboardEditor } from "@/pages/dashboard/DashboardEditor";
import { readPeriod, writePeriod, type PeriodChange } from "@/pages/dashboard/period";
import { PeriodBar } from "@/pages/dashboard/PeriodBar";
import { useFormatters } from "@/pages/dashboard/format";
import { WidgetCard } from "@/pages/dashboard/widgets";

// The home dashboard. The period, comparison and time step live in the URL; the widget layout is
// saved per company (Settings: Edit can change it); each figure comes from the dashboard API, and
// widgets for areas the user can't see are left out.
export function Dashboard() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { activeCompany, companies, loading } = useCompany();
  const companyId = activeCompany?.id ?? null;

  if (!activeCompany) {
    // Still loading companies — show nothing to avoid a flash
    if (loading) return null;

    // No companies at all — first-time user welcome
    if (companies.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <Building2 className="size-8 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">{intl.formatMessage({ id: "dashboard.welcomeTitle" })}</h2>
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "dashboard.welcomeDescription" })}</p>
            <Button size="lg" onClick={() => navigate("/select-company")}>
              {intl.formatMessage({ id: "dashboard.createCompany" })}
            </Button>
          </div>
        </div>
      );
    }

    // Companies exist but none selected
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "dashboard.noCompanyTitle" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "dashboard.noCompanyDescription" })}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <CompanyDashboard key={companyId} companyId={activeCompany.id} companyName={activeCompany.name} />;
}

function CompanyDashboard({ companyId, companyName }: { companyId: string; companyName: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const f = useFormatters();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const period = useMemo(() => readPeriod(searchParams), [searchParams]);
  const [draft, setDraft] = useState<DashboardWidgetConfig[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const layoutKey = ["dashboardLayout", companyId];
  const layoutQuery = useQuery({ queryKey: layoutKey, queryFn: () => apiClient.getDashboardLayout(companyId) });
  const dataQuery = useQuery({
    queryKey: ["dashboard", companyId, period.range, period.compare, period.granularity],
    queryFn: () =>
      apiClient.getDashboard(
        companyId,
        period.range.from,
        period.range.to,
        period.compare?.from,
        period.compare?.to,
        period.granularity === "auto" ? undefined : period.granularity,
      ),
    // Refetching keeps the previous frame on screen (dimmed) — no skeleton flash.
    placeholderData: keepPreviousData,
  });

  const onSaved = (layout: DashboardLayoutResponse) => {
    queryClient.setQueryData(layoutKey, layout);
    setDraft(null);
    setError(null);
  };
  const saveMutation = useMutation({
    mutationFn: (widgets: DashboardWidgetConfig[]) => apiClient.saveDashboardLayout(companyId, { widgets }),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("dashboard.edit.saveError"))),
  });
  const resetMutation = useMutation({
    mutationFn: () => apiClient.resetDashboardLayout(companyId),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("dashboard.edit.saveError"))),
  });

  const data = dataQuery.data;
  const layout = layoutQuery.data;
  const widgets = draft ?? layout?.widgets ?? [];
  const visible = widgets.filter((w) => {
    const def = widgetDef(w.key);
    return def && canShow(def, data?.sections);
  });
  const suggestions = suggestionsFor(data, widgets, !!period.compare, f.money).filter((s) => !dismissed.includes(s.id));

  function changePeriod(change: PeriodChange) {
    setSearchParams(writePeriod(searchParams, change), { replace: true });
  }

  function applySuggestion(s: Suggestion) {
    if (s.action.kind === "compare") {
      changePeriod({ compareKind: "lastYear" });
      return;
    }
    const next = [...widgets, newWidget(s.action.key)];
    if (layout?.canEdit) {
      if (draft) setDraft(next);
      else saveMutation.mutate(next);
    } else {
      setDismissed((d) => [...d, s.id]);
    }
  }

  const loadError = dataQuery.error ? getApiErrorMessage(dataQuery.error, t("dashboard.loadError")) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{companyName}</h1>
          <p className="text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        {layout?.canEdit && !draft && (
          <Button size="sm" variant="outline" onClick={() => setDraft(layout.widgets.filter((w) => widgetDef(w.key)))}>
            <Settings2 className="size-4" />
            {t("dashboard.edit.open")}
          </Button>
        )}
      </div>

      <PeriodBar period={period} onChange={changePeriod} />

      {(error || loadError) && (
        <Alert variant="destructive">
          <AlertDescription>{error ?? loadError}</AlertDescription>
        </Alert>
      )}

      {draft && (
        <DashboardEditor
          widgets={draft}
          onChange={setDraft}
          sections={data?.sections}
          saving={saveMutation.isPending || resetMutation.isPending}
          onSave={() => saveMutation.mutate(draft)}
          onCancel={() => {
            setDraft(null);
            setError(null);
          }}
          onReset={() => resetMutation.mutate()}
        />
      )}

      {suggestions.length > 0 && !draft && (
        <ul className="flex flex-col gap-2" aria-label={t("dashboard.suggest.title")}>
          {suggestions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border border-info-border bg-info px-3 py-2 text-sm text-info-foreground">
              <Lightbulb className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">{t(s.messageId, s.values)}</span>
              {(s.action.kind === "compare" || layout?.canEdit) && (
                <Button size="xs" variant="outline" onClick={() => applySuggestion(s)}>
                  {t(s.action.kind === "compare" ? "dashboard.suggest.doCompare" : "dashboard.suggest.doAdd")}
                </Button>
              )}
              <button
                type="button"
                className="rounded p-0.5 hover:bg-info-border/40"
                aria-label={t("dashboard.suggest.dismiss")}
                onClick={() => setDismissed((d) => [...d, s.id])}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {visible.map((widget) => (
            <WidgetCard key={`${widget.key}-${widget.visual}`} widget={widget} data={data} dimmed={dataQuery.isFetching} />
          ))}
        </div>
      )}
      {data && visible.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">{t(layout?.canEdit ? "dashboard.emptyCanEdit" : "dashboard.emptyLayout")}</p>
      )}
    </div>
  );
}
