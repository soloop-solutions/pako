import { useIntl } from "react-intl";

import { Badge } from "@/components/ui/badge";
import { documentStateBadgeVariant } from "@/lib/document-types";

// UI/UX round 2026-11-24: a document's state (Draft / Posted / Cancelled) as a badge with its
// translated label; it used to print the English enum value under Albanian too.
export function DocumentStateBadge({ state }: { state: string }) {
  const intl = useIntl();
  const key = `enum.state.${state.toLowerCase()}`;
  const label = key in intl.messages ? intl.formatMessage({ id: key }) : state;
  return <Badge variant={documentStateBadgeVariant(state)}>{label}</Badge>;
}
