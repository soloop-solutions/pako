import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import type { TrialBalanceLine } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";

export function Dashboard() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { activeCompany, companies, loading } = useCompany();
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
    // Still loading companies — show nothing to avoid a flash
    if (loading) return null;

    // No companies at all — first-time user welcome
    if (companies.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <Building2 className="size-8 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">{intl.formatMessage({ id: "dashboard.welcomeTitle" })}</h2>
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "dashboard.welcomeDescription" })}</p>
            <Button size="lg" onClick={() => navigate("/companies")}>
              {intl.formatMessage({ id: "dashboard.createCompany" })}
            </Button>
          </div>
        </div>
      );
    }

    // Companies exist but none selected
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "dashboard.noCompanyTitle" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "dashboard.noCompanyDescription" })}</CardDescription>
        </CardHeader>
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
