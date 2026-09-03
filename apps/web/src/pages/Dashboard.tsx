import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import type { TrialBalanceLine } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";

export function Dashboard() {
  const intl = useIntl();
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
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "dashboard.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "dashboard.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "dashboard.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
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
          <CardDescription>{intl.formatMessage({ id: "dashboard.postedTrialBalanceSnapshot" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-md border px-4 py-3">
              <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "dashboard.accountsWithPostedActivity" })}</p>
              <p className="text-2xl font-semibold">{trialBalance.length}</p>
            </div>
            <div className="rounded-md border px-4 py-3">
              <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "dashboard.totalPostedDebit" })}</p>
              <p className="text-2xl font-semibold">{totalDebit.toFixed(2)}</p>
            </div>
            <div className="rounded-md border px-4 py-3">
              <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "dashboard.totalPostedCredit" })}</p>
              <p className="text-2xl font-semibold">{totalCredit.toFixed(2)}</p>
            </div>
          </div>
          {trialBalance.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">{intl.formatMessage({ id: "dashboard.noPostedActivity" })}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
