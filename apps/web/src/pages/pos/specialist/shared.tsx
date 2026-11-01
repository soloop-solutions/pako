import type { ReactNode } from "react";
import { useIntl } from "react-intl";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { usePosStores } from "@/hooks/usePos";
import { cn } from "@/lib/utils";

// docs/POS_PLAN.md P7: small pieces shared by the specialist-retail screens.

/** Tabs of a screen; the chosen one lives in the URL (?tab=) so the screen is linkable. */
export function TabBar<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (tab: T) => void;
  label: string;
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

/** The store picker of a screen that works on one store. */
export function StoreSelect({ value, onChange, id = "spec-store" }: { value: string; onChange: (storeId: string) => void; id?: string }) {
  const intl = useIntl();
  const stores = usePosStores().data ?? [];
  return (
    <div className="flex w-64 flex-col gap-1">
      <Label htmlFor={id}>{intl.formatMessage({ id: "spec.store" })}</Label>
      <Select id={id} value={value} onValueChange={onChange} options={stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
    </div>
  );
}

/** A labelled form field with an optional hint. */
export function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
