import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface AuditVerifyPanelProps {
  companyId: string;
  onOpenEntry: (entryId: string) => void;
}

export function AuditVerifyPanel({ companyId, onOpenEntry }: AuditVerifyPanelProps) {
  const intl = useIntl();
  const mutation = useMutation({ mutationFn: () => apiClient.auditVerify(companyId) });
  const result = mutation.data;

  const reasonId = result?.reason && `audit.verify.reason.${result.reason}` in intl.messages
    ? `audit.verify.reason.${result.reason}`
    : "audit.verify.reason.unknown";

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="outline" size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <ShieldCheck className="size-4" />
          {intl.formatMessage({ id: mutation.isPending ? "audit.verify.running" : "audit.verify.button" })}
        </Button>
      </div>
      <div aria-live="polite">
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(mutation.error, intl.formatMessage({ id: "audit.verify.error" }))}</AlertDescription>
          </Alert>
        )}
        {result?.valid && (
          <Alert data-testid="audit-verify-valid">
            <CheckCircle2 className="size-4 text-success" />
            <AlertDescription>
              <p className="font-medium text-foreground">{intl.formatMessage({ id: "audit.verify.validTitle" })}</p>
              <p>{intl.formatMessage({ id: "audit.verify.validBody" }, { checked: result.checkedCount })}</p>
              {result.unchainedCount > 0 && <p>{intl.formatMessage({ id: "audit.verify.unchained" }, { count: result.unchainedCount })}</p>}
            </AlertDescription>
          </Alert>
        )}
        {result && !result.valid && (
          <Alert variant="destructive" data-testid="audit-verify-broken">
            <ShieldAlert className="size-4" />
            <AlertDescription>
              <p className="font-medium">{intl.formatMessage({ id: "audit.verify.brokenTitle" })}</p>
              <p>
                {intl.formatMessage(
                  { id: "audit.verify.brokenBody" },
                  { sequence: result.firstBrokenSequence ?? "?", checked: result.checkedCount },
                )}
              </p>
              <p>
                {intl.formatMessage({ id: "audit.verify.reasonLabel" })}: {intl.formatMessage({ id: reasonId })}
              </p>
              {result.firstBrokenId && (
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onOpenEntry(result.firstBrokenId as string)}>
                  {intl.formatMessage({ id: "audit.verify.openBroken" })}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
