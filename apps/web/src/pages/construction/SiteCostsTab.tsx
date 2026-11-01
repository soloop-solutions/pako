import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { CostCodeProgressRow, SiteResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { vxKeys } from "@/hooks/useVerticals";
import { cn } from "@/lib/utils";
import { ErrorAlert, Field, Tile } from "@/pages/verticals/shared";
import { amount, parseNum, usePercent, useT } from "@/pages/verticals/verticals-utils";

// docs/ERP_VERTICALS_PLAN.md §1 — costs and percentage of completion (shkalla e përfundimit): budget
// vs actual per cost code, earned revenue vs billed (over/under billing), retention held and its
// release. Every figure is the API's.
export function SiteCostsTab({ site }: { site: SiteResponse }) {
  const intl = useIntl();
  const t = useT();
  const percent = usePercent();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const query = useQuery({
    queryKey: vxKeys.siteProgress(activeCompanyId, site.id),
    queryFn: () => apiClient.getSiteProgress(activeCompanyId as string, site.id),
    enabled: !!activeCompanyId,
  });
  const p = query.data;
  const [release, setRelease] = useState("");
  const [error, setError] = useState<string | null>(null);
  const releaseMutation = useMutation({
    mutationFn: () => apiClient.releaseSiteRetention(activeCompanyId as string, site.id, { amount: parseNum(release) || 0 }),
    onSuccess: async (progress) => {
      setRelease("");
      queryClient.setQueryData(vxKeys.siteProgress(activeCompanyId, site.id), progress);
      await queryClient.invalidateQueries({ queryKey: vxKeys.site(activeCompanyId, site.id) });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.retention.releaseError"))),
  });

  const columns = useMemo<ColumnDef<CostCodeProgressRow>[]>(
    () => [
      { accessorKey: "code", header: t("common.code"), cell: ({ row }) => row.original.costCodeId ? row.original.code : <span className="italic text-muted-foreground">{t("vx.costs.noCode")}</span> },
      { accessorKey: "name", header: t("common.name") },
      { accessorKey: "budget", header: t("vx.budget"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "actual", header: t("vx.costs.actual"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      {
        accessorKey: "variance",
        header: t("vx.costs.variance"),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return <span className={cn(v < 0 && "font-semibold text-destructive")}>{amount(v)}</span>;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    releaseMutation.mutate();
  }

  return (
    <div className="flex flex-col gap-4">
      {p && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Tile label={t("vx.site.contractValue")} value={amount(p.contractValue)} />
          <Tile label={t("vx.costs.budgetCost")} value={amount(p.budgetCost)} />
          <Tile label={t("vx.costs.actualCost")} value={amount(p.actualCost)} warn={p.actualCost > p.budgetCost} />
          <Tile label={t("vx.site.percentComplete")} value={percent(p.percentComplete)} testId="kpi-percent" />
          <Tile label={t("vx.costs.earnedRevenue")} value={amount(p.earnedRevenue)} />
          <Tile label={t("vx.site.billed")} value={amount(p.billed)} />
          <Tile label={p.overUnderBilling >= 0 ? t("vx.costs.overBilling") : t("vx.costs.underBilling")} value={amount(p.overUnderBilling)} warn={p.overUnderBilling !== 0} />
          <Tile label={t("vx.costs.ledgerRevenue")} value={amount(p.ledgerRevenue)} />
          <Tile label={t("vx.costs.retentionHeld")} value={amount(p.retentionHeld)} testId="kpi-retention" />
          <Tile label={t("vx.costs.margin")} value={amount(p.margin)} warn={p.margin < 0} />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("vx.costCodes")}</CardTitle>
          <CardDescription>{t("vx.costs.hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="site-cost-codes"
            columns={columns}
            data={p?.costCodes ?? []}
            rowCount={p?.costCodes.length ?? 0}
            isLoading={query.isPending}
            getRowId={(r, i) => r.costCodeId ?? `none-${i}`}
            emptyMessage={t("vx.costs.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("vx.retention.title")}</CardTitle>
          <CardDescription>
            {t("vx.retention.hint", { percent: intl.formatNumber(site.retentionPercent), released: amount(site.retentionReleased) })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canApprove("sales") ? (
            <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
              <ErrorAlert error={error} />
              <Field id="ret-amount" label={t("vx.retention.amount")} className="w-44">
                <Input id="ret-amount" inputMode="decimal" className="text-right tnum" required value={release} onChange={(e) => setRelease(e.target.value)} />
              </Field>
              <Button type="submit" disabled={releaseMutation.isPending || !release}>{t("vx.retention.release")}</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t("vx.retention.needsApprove")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
