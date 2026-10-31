import { useIntl } from "react-intl";

import { Badge } from "@/components/ui/badge";
import { PurchaseOrderState } from "@/lib/purchase-order-enums";

// State shows in form, not only in words: draft muted, cancelled struck through.
export function PurchaseOrderStateBadge({ state }: { state: number }) {
  const intl = useIntl();
  const label = intl.formatMessage({ id: `po.state.${state}` });
  if (state === PurchaseOrderState.Draft) return <Badge variant="outline" className="italic">{label}</Badge>;
  if (state === PurchaseOrderState.Confirmed) return <Badge>{label}</Badge>;
  if (state === PurchaseOrderState.Cancelled) return <Badge variant="secondary" className="line-through">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

// How much of the order is billed: none / partly / full (from the API).
export function ProgressBadge({ progress }: { progress: string }) {
  const intl = useIntl();
  const label = intl.formatMessage({ id: `po.progress.${progress}` });
  if (progress === "full") return <Badge variant="success">{label}</Badge>;
  if (progress === "partly") return <Badge variant="warning">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}
