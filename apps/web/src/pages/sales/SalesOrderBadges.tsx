import { useIntl } from "react-intl";

import { Badge } from "@/components/ui/badge";
import { SalesOrderState } from "@/lib/sales-order-enums";

// State shows in form, not only in words: draft muted, cancelled struck through.
export function SalesOrderStateBadge({ state }: { state: number }) {
  const intl = useIntl();
  const label = intl.formatMessage({ id: `so.state.${state}` });
  if (state === SalesOrderState.Draft) return <Badge variant="draft">{label}</Badge>;
  if (state === SalesOrderState.Quoted) return <Badge variant="info">{label}</Badge>;
  if (state === SalesOrderState.Confirmed) return <Badge>{label}</Badge>;
  if (state === SalesOrderState.Cancelled) return <Badge variant="cancelled">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

// How much of the order is delivered or invoiced: none / partly / full (from the API).
export function SalesProgressBadge({ kind, progress }: { kind: "delivery" | "invoicing"; progress: string }) {
  const intl = useIntl();
  const label = intl.formatMessage({ id: `so.${kind}.${progress}` });
  if (progress === "full") return <Badge variant="success">{label}</Badge>;
  if (progress === "partly") return <Badge variant="warning">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}
