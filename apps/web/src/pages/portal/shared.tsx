import { useIntl } from "react-intl";

import { Badge } from "@/components/ui/badge";

// An order's status as the customer sees it (PortalService.Status): drafts read "Submitted".
export function PortalOrderStatus({ status }: { status: string }) {
  const intl = useIntl();
  const label = intl.formatMessage({ id: `portal.status.${status}` });
  if (status === "Cancelled") return <Badge variant="secondary" className="line-through">{label}</Badge>;
  if (status === "Confirmed") return <Badge variant="default">{label}</Badge>;
  if (status === "Submitted") return <Badge variant="outline">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}
