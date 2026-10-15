import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { payrollRunActions, type PayrollRunAction } from "@/lib/payroll-enums";

const ACTION_LABELS: Record<PayrollRunAction, { idle: string; busy: string }> = {
  recompute: { idle: "payroll.action.recompute", busy: "payroll.action.recomputing" },
  approve: { idle: "payroll.action.approve", busy: "payroll.action.approving" },
  returnToDraft: { idle: "payroll.action.returnToDraft", busy: "payroll.action.returning" },
  post: { idle: "payroll.action.post", busy: "payrollRunDetail.posting" },
  pay: { idle: "payroll.action.pay", busy: "payroll.action.paying" },
  delete: { idle: "payroll.action.delete", busy: "payroll.action.deleting" },
};

const ACTION_VARIANTS: Record<PayrollRunAction, "default" | "outline" | "destructive" | "ghost"> = {
  recompute: "outline",
  approve: "outline",
  returnToDraft: "outline",
  post: "default",
  pay: "default",
  delete: "ghost",
};

type PayrollRunActionsProps = {
  state: string;
  busyAction: PayrollRunAction | null;
  onAction: (action: PayrollRunAction) => void;
};

// The state-dependent workflow buttons of a payroll run — Draft: Recompute, Approve, Post, Delete;
// Approved: Return to draft, Post; Posted: Pay; Paid: nothing.
export function PayrollRunActions({ state, busyAction, onAction }: PayrollRunActionsProps) {
  const intl = useIntl();
  const actions = payrollRunActions(state);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action}
          type="button"
          size="sm"
          variant={ACTION_VARIANTS[action]}
          className={action === "delete" ? "text-destructive" : undefined}
          disabled={busyAction !== null}
          onClick={() => onAction(action)}
        >
          {intl.formatMessage({ id: busyAction === action ? ACTION_LABELS[action].busy : ACTION_LABELS[action].idle })}
        </Button>
      ))}
    </div>
  );
}
