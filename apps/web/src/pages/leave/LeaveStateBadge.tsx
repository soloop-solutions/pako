import { useIntl } from "react-intl";

import { Badge } from "@/components/ui/badge";
import { isLeaveState } from "@/pages/leave/leaveShared";

// State shows in form, not only in words: pending carries the warning bar, approved the success
// fill, rejected a muted red outline, cancelled is struck through.
export function LeaveStateBadge({ state }: { state: string }) {
  const intl = useIntl();
  const label = isLeaveState(state) ? intl.formatMessage({ id: `leave.state.${state}` }) : state;
  switch (state) {
    case "Pending":
      return <Badge variant="warning">{label}</Badge>;
    case "Approved":
      return <Badge variant="success">{label}</Badge>;
    case "Rejected":
      return (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          {label}
        </Badge>
      );
    case "Cancelled":
      return <Badge variant="cancelled">{label}</Badge>;
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}
