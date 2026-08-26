import { useCallback, useEffect, useState } from "react";
import type { TrialBalanceLine } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";

export function Dashboard() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [trialBalance, setTrialBalance] = useState<TrialBalanceLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      setTrialBalance(await apiClient.trialBalance(companyId));
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load the dashboard summary."));
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
          <CardDescription>Overview of the active company's financial position.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select or create a company on the Companies page first.</p>
        </CardContent>
      </Card>
    );
  }

  const totalDebit = trialBalance.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = trialBalance.reduce((sum, line) => sum + line.credit, 0);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{activeCompany.name}</CardTitle>
          <CardDescription>Posted trial balance snapshot.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-md border px-4 py-3">
              <p className="text-sm text-muted-foreground">Accounts with posted activity</p>
              <p className="text-2xl font-semibold">{trialBalance.length}</p>
            </div>
            <div className="rounded-md border px-4 py-3">
              <p className="text-sm text-muted-foreground">Total posted debit</p>
              <p className="text-2xl font-semibold">{totalDebit.toFixed(2)}</p>
            </div>
            <div className="rounded-md border px-4 py-3">
              <p className="text-sm text-muted-foreground">Total posted credit</p>
              <p className="text-2xl font-semibold">{totalCredit.toFixed(2)}</p>
            </div>
          </div>
          {trialBalance.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No posted activity yet. See the Ledger page to get started.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
