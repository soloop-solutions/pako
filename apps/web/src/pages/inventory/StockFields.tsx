import { useIntl } from "react-intl";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useWarehouses } from "@/hooks/useStock";
import { cn } from "@/lib/utils";

// The warehouse a document's stock-tracked lines move in or out of. Hidden while the company has
// only one warehouse (that one is used); "" = the company's default warehouse.
export function WarehouseField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const intl = useIntl();
  const warehouses = (useWarehouses().data ?? []).filter((w) => w.isActive);
  if (warehouses.length < 2) return null;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{intl.formatMessage({ id: "stock.warehouse" })}</Label>
      <Select
        id={id}
        value={value || (warehouses.find((w) => w.isDefault)?.id ?? "")}
        onValueChange={onChange}
        options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
      />
    </div>
  );
}

// "In stock: 5" under a line's quantity for stock-tracked items; red when the line asks for more
// than there is (an invoice will be refused, or go below zero under "warn").
export function OnHandHint({ onHand, requested, warnWhenShort, className }: { onHand: number | undefined; requested: number; warnWhenShort: boolean; className?: string }) {
  const intl = useIntl();
  if (onHand === undefined) return null;
  const short = warnWhenShort && requested > onHand;
  return (
    <span className={cn("text-[11px] tnum", className, short ? "font-semibold text-destructive" : "text-muted-foreground")} role={short ? "alert" : undefined}>
      {intl.formatMessage({ id: short ? "stock.onHand.short" : "stock.onHand" }, { qty: intl.formatNumber(onHand) })}
    </span>
  );
}
