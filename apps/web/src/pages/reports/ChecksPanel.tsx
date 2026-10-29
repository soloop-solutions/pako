import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { formatAmount } from "./helpers";
import { useReportPeriod } from "./useReportPeriod";

export function ChecksPanel({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const { from, to, setFrom, setTo } = useReportPeriod();

  const query = useQuery({
    queryKey: ["reports", "checks", companyId, from, to] as const,
    queryFn: () => apiClient.checks(companyId, from, to),
  });

  const checks = query.data?.checks ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{intl.formatMessage({ id: "reports.checksTitle" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "reports.checksDescription" }, { from, to })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="checks-from">{intl.formatMessage({ id: "reports.checksFrom" })}</Label>
            <Input id="checks-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="checks-to">{intl.formatMessage({ id: "reports.checksTo" })}</Label>
            <Input id="checks-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
        </div>
        {query.isError && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "reports.checksLoadError" })}</p>}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {checks.map((check) => {
            const labelId = `reports.checksLabel.${check.key}`;
            const label = intl.messages[labelId] ? intl.formatMessage({ id: labelId }) : check.key;
            return (
              <div
                key={check.key}
                data-check={check.key}
                data-passed={String(check.passed)}
                className={cn(
                  "flex flex-col gap-1 rounded-md border p-2 text-xs",
                  !check.passed && "border-amber-300 bg-amber-50 text-amber-900",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{label}</span>
                  <Badge variant="outline" className={cn("gap-1", check.passed ? "text-emerald-700" : "border-amber-400 text-amber-700")}>
                    {check.passed ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                    {intl.formatMessage({ id: check.passed ? "reports.checksPassed" : "reports.checksFailed" })}
                  </Badge>
                </div>
                <div className="flex justify-between tabular-nums">
                  <span>{intl.formatMessage({ id: "reports.checksExpected" })}</span>
                  <span>{formatAmount(check.expected)}</span>
                </div>
                <div className="flex justify-between tabular-nums">
                  <span>{intl.formatMessage({ id: "reports.checksActual" })}</span>
                  <span>{formatAmount(check.actual)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
