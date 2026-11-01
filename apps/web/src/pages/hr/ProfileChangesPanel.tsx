import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/pages/leave/leaveShared";

// F9: bank-account changes employees asked for in "My profile". Nothing changes on the employee
// until one is approved here. Renders nothing when none are waiting.
export function ProfileChangesPanel({ companyId, canDecide }: { companyId: string; canDecide: boolean }) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const queryKey = ["profileChanges", companyId, "Pending"] as const;

  const changesQuery = useQuery({ queryKey, queryFn: () => apiClient.listEmployeeProfileChanges(companyId, "Pending", undefined) });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? apiClient.approveEmployeeProfileChange(companyId, id) : apiClient.rejectEmployeeProfileChange(companyId, id),
    onSuccess: async (_result, { approve }) => {
      toast.success(intl.formatMessage({ id: approve ? "toast.profileChangeApproved" : "toast.profileChangeRejected" }));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["profileChanges", companyId] });
      await queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "hr.profileChanges.decideError" }))),
  });

  const changes = changesQuery.data ?? [];
  if (changes.length === 0) return null;

  return (
    <Card className="border-amber-300 dark:border-amber-700">
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "hr.profileChanges.title" }, { count: changes.length })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "hr.profileChanges.description" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {changes.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-b-0">
            <div className="flex flex-col">
              <span className="font-medium">{c.employeeName}</span>
              <span className="font-mono text-xs">
                <span className="text-muted-foreground line-through">{c.previousIban ?? "—"}</span>
                {" → "}
                {c.newIban}
                {c.newBankName ? ` (${c.newBankName})` : ""}
              </span>
              <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "hr.profileChanges.requested" }, { date: formatDate(c.requestedAt) })}</span>
            </div>
            {canDecide && (
              <div className="flex gap-1">
                <Button size="xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, approve: true })}>
                  {intl.formatMessage({ id: "me.leave.approve" })}
                </Button>
                <Button size="xs" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, approve: false })}>
                  {intl.formatMessage({ id: "me.leave.reject" })}
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
