import { useIntl } from "react-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const variants: Record<string, "default" | "destructive" | "outline" | "draft" | "info" | "success" | "warning" | "cancelled"> = {
  Draft: "draft",
  Submitted: "warning",
  BillDraft: "info",
  Posted: "default",
  Reimbursed: "success",
  Rejected: "destructive",
  Cancelled: "cancelled",
  BillCancelled: "destructive",
};

// H13: one claim's stage — from Draft to Reimbursed — as the API reports it.
export function ExpenseStageBadge({ stage }: { stage: string }) {
  const intl = useIntl();
  return (
    <Badge variant={variants[stage] ?? "outline"} className={cn(stage === "Cancelled" && "line-through")}>
      {intl.formatMessage({ id: `expenses.stage.${stage}` })}
    </Badge>
  );
}
