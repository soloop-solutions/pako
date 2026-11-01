import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { CommissionPlanResponse } from "@pako/shared";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { formatAmount } from "@/lib/payroll-enums";

// Mirrors CommissionBasis (numeric on the wire).
const Basis = { InvoicedNet: 0, PaidNet: 1 } as const;

// G11: plans an employee earns commission under, on the partners assigned to them. The amounts
// are computed by the API from posted invoices ("Calculate commissions" on Payroll → Adjustments).
export function CommissionPlans() {
  const intl = useIntl();
  const { activeCompanyId: companyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CommissionPlanResponse | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [basis, setBasis] = useState<number>(Basis.InvoicedNet);
  const [ratePercent, setRatePercent] = useState("");
  const [threshold, setThreshold] = useState("");
  const [isActive, setIsActive] = useState(true);

  const plansQuery = useQuery({
    queryKey: ["commissionPlans", companyId],
    queryFn: () => apiClient.listCommissionPlans(companyId as string),
    enabled: !!companyId,
  });

  function open(plan: CommissionPlanResponse | "new") {
    setEditing(plan);
    setError(null);
    const p = plan === "new" ? null : plan;
    setName(p?.name ?? "");
    setBasis(p?.basis ?? Basis.InvoicedNet);
    // The rate is a fraction on the wire and a percentage in the form.
    setRatePercent(p ? String(+(p.rate * 100).toFixed(4)) : "");
    setThreshold(p?.minThreshold == null ? "" : String(p.minThreshold));
    setIsActive(p?.isActive ?? true);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        basis,
        rate: Number(ratePercent.replace(",", ".")) / 100,
        minThreshold: threshold.trim() === "" ? undefined : Number(threshold.replace(",", ".")),
        isActive,
      };
      return editing && editing !== "new"
        ? apiClient.updateCommissionPlan(companyId as string, editing.id, body)
        : apiClient.createCommissionPlan(companyId as string, body);
    },
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      toast.success(intl.formatMessage({ id: "toast.commissionPlanSaved" }));
      await queryClient.invalidateQueries({ queryKey: ["commissionPlans", companyId] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "commission.plan.saveError" }))),
  });

  const basisLabel = (value: number) => intl.formatMessage({ id: value === Basis.PaidNet ? "commission.basis.paidNet" : "commission.basis.invoicedNet" });

  const columns = useMemo<ColumnDef<CommissionPlanResponse>[]>(
    () => [
      { accessorKey: "name", header: intl.formatMessage({ id: "commission.plan.name" }) },
      { accessorKey: "basis", header: intl.formatMessage({ id: "commission.plan.basis" }), cell: ({ getValue }) => basisLabel(getValue() as number) },
      {
        accessorKey: "rate",
        header: intl.formatMessage({ id: "commission.plan.rate" }),
        meta: { numeric: true },
        cell: ({ getValue }) => `${intl.formatNumber((getValue() as number) * 100, { maximumFractionDigits: 4 })}%`,
      },
      {
        accessorKey: "minThreshold",
        header: intl.formatMessage({ id: "commission.plan.threshold" }),
        meta: { numeric: true },
        cell: ({ getValue }) => (getValue() == null ? "—" : formatAmount(getValue() as number)),
      },
      { accessorKey: "employeeCount", header: intl.formatMessage({ id: "commission.plan.employees" }), meta: { numeric: true } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const rate = Number(ratePercent.replace(",", "."));
    if (!name.trim() || !Number.isFinite(rate) || rate <= 0 || rate >= 100) {
      setError(intl.formatMessage({ id: "commission.plan.invalid" }));
      return;
    }
    saveMutation.mutate();
  }

  if (!companyId) return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  const plans = plansQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <CardTitle>{intl.formatMessage({ id: "nav.commissionPlans" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "nav.commissionPlans.description" })}</CardDescription>
          </div>
          {canWrite("payroll") && !editing && (
            <Button size="sm" onClick={() => open("new")}>
              {intl.formatMessage({ id: "commission.plan.new" })}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {editing && (
          <form className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-5 sm:items-end" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-name">{intl.formatMessage({ id: "commission.plan.name" })}</Label>
              <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-basis">{intl.formatMessage({ id: "commission.plan.basis" })}</Label>
              <Select
                id="plan-basis"
                value={String(basis)}
                onValueChange={(v) => setBasis(Number(v))}
                options={[Basis.InvoicedNet, Basis.PaidNet].map((b) => ({ value: String(b), label: basisLabel(b) }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-rate">{intl.formatMessage({ id: "commission.plan.rate" })} (%)</Label>
              <Input id="plan-rate" inputMode="decimal" className="text-right tabular-nums" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-threshold">{intl.formatMessage({ id: "commission.plan.threshold" })}</Label>
              <Input id="plan-threshold" inputMode="decimal" className="text-right tabular-nums" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                {intl.formatMessage({ id: "leave.types.active" })}
              </label>
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                {intl.formatMessage({ id: "common.save" })}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-5">{intl.formatMessage({ id: "commission.plan.hint" })}</p>
          </form>
        )}
        <DataGrid
          gridId="commission-plans"
          columns={columns}
          data={plans}
          rowCount={plans.length}
          isLoading={plansQuery.isPending}
          getRowId={(row) => row.id}
          getRowClassName={(row) => (row.isActive ? undefined : "text-muted-foreground")}
          onRowClick={canWrite("payroll") ? (row) => open(row) : undefined}
          emptyMessage={intl.formatMessage({ id: "commission.plan.empty" })}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}
