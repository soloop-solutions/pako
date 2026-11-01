import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { usePartners } from "@/hooks/useDistribution";
import { useItemLookup } from "@/hooks/useItemLookup";
import { cn } from "@/lib/utils";
import {
  ContractState, LeaseState, ProgressBillState, ReservationState, SiteState, UnitState,
} from "@/lib/verticals-enums";
import { useT } from "@/pages/verticals/verticals-utils";

// docs/ERP_VERTICALS_PLAN.md (POS plan P8) — pieces shared by the construction, real estate and
// rental screens. Every figure shown comes from the API; nothing here computes money.

export function Tile({ label, value, warn, testId }: { label: string; value: string; warn?: boolean; testId?: string }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", warn && "border-warning-border")} data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", warn && "text-warning-foreground")}>{value}</div>
    </div>
  );
}

export function ErrorAlert({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

export function TabBar({ tabs, value, onChange, label }: {
  tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium",
            value === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ id, label, children, hint, className }: { id?: string; label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// An item picker that searches the server and keeps the label of an item already chosen.
export function ItemField({ id, label, value, onChange, hint, disabled, fallbackLabel }: {
  id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; disabled?: boolean; fallbackLabel?: string;
}) {
  const t = useT();
  const lookup = useItemLookup([value]);
  const options = lookup.search.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
  if (value && !options.some((o) => o.value === value)) {
    const found = lookup.find(value);
    options.unshift({ value, label: found ? `${found.code} · ${found.name}` : fallbackLabel ?? value });
  }
  return (
    <Field id={id} label={label} hint={hint}>
      <SearchableSelect id={id} value={value} onChange={onChange} disabled={disabled} options={options}
        placeholder={t("vx.pickItem")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")}
        onSearchChange={lookup.search.onSearchChange} />
    </Field>
  );
}

export function PartnerField({ id, label, value, onChange, role, disabled, fallbackLabel }: {
  id: string; label: string; value: string; onChange: (v: string) => void; role?: "customer" | "vendor"; disabled?: boolean; fallbackLabel?: string;
}) {
  const t = useT();
  const partners = (usePartners().data ?? []).filter((p) => (role === "customer" ? p.isCustomer : role === "vendor" ? p.isVendor : true) || p.id === value);
  const options = partners.map((p) => ({ value: p.id, label: p.taxNumber ? `${p.name} · ${p.taxNumber}` : p.name }));
  if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: fallbackLabel ?? value });
  return (
    <Field id={id} label={label}>
      <SearchableSelect id={id} value={value} onChange={onChange} disabled={disabled} options={options}
        placeholder={t("vx.pickPartner")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")} />
    </Field>
  );
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "draft" | "cancelled";

function StateBadge({ label, variant, testId }: { label: string; variant: BadgeVariant; testId?: string }) {
  return <Badge variant={variant} data-testid={testId}>{label}</Badge>;
}

export function SiteStateBadge({ state }: { state: number }) {
  const t = useT();
  const variant: BadgeVariant = state === SiteState.Tender ? "draft" : state === SiteState.Active ? "info" : state === SiteState.Completed ? "success" : "secondary";
  return <StateBadge label={t(`vx.siteState.${state}`)} variant={variant} />;
}

export function ProgressBillStateBadge({ state }: { state: number }) {
  const t = useT();
  const variant: BadgeVariant = state === ProgressBillState.Draft ? "draft" : state === ProgressBillState.Approved ? "info" : "success";
  return <StateBadge label={t(`vx.billState.${state}`)} variant={variant} />;
}

export function UnitStateBadge({ state }: { state: number }) {
  const t = useT();
  const variant: BadgeVariant = state === UnitState.Available ? "success" : state === UnitState.Reserved ? "warning"
    : state === UnitState.Rented ? "info" : "secondary";
  return <StateBadge label={t(`vx.unitState.${state}`)} variant={variant} />;
}

export function ReservationStateBadge({ state }: { state: number }) {
  const t = useT();
  const variant: BadgeVariant = state === ReservationState.Active ? "warning" : state === ReservationState.Converted ? "success"
    : state === ReservationState.Cancelled ? "cancelled" : "secondary";
  return <StateBadge label={t(`vx.reservationState.${state}`)} variant={variant} />;
}

export function ContractStateBadge({ state }: { state: number }) {
  const t = useT();
  const variant: BadgeVariant = state === ContractState.Active ? "info" : state === ContractState.Completed ? "success" : "cancelled";
  return <StateBadge label={t(`vx.contractState.${state}`)} variant={variant} />;
}

export function LeaseStateBadge({ state }: { state: number }) {
  const t = useT();
  const variant: BadgeVariant = state === LeaseState.Draft ? "draft" : state === LeaseState.Active ? "success" : "secondary";
  return <StateBadge label={t(`vx.leaseState.${state}`)} variant={variant} />;
}

// A state filter kept in the URL by the caller ("" = all).
export function StateFilter({ value, onChange, states, labelPrefix, label }: {
  value: string; onChange: (v: string) => void; states: readonly number[]; labelPrefix: string; label: string;
}) {
  const t = useT();
  return (
    <div className="inline-flex w-fit flex-wrap rounded-md border bg-card p-0.5" role="radiogroup" aria-label={label}>
      {["", ...states.map(String)].map((v) => (
        <button
          key={v || "all"}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-7 rounded-[5px] px-3 text-[12.5px] font-medium",
            value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {v === "" ? t("vx.all") : t(`${labelPrefix}.${v}`)}
        </button>
      ))}
    </div>
  );
}
