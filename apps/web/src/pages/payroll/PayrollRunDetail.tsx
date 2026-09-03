import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useParams } from "react-router-dom";
import type { EmployeeResponse, PayrollRunResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";

export function PayrollRunDetail() {
  const intl = useIntl();
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [run, setRun] = useState<PayrollRunResponse | null>(null);
  const [employees, setEmployees] = useState<EmployeeResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId || !id) return;
    setError(null);
    try {
      const [runResult, employeesResult] = await Promise.all([
        apiClient.payrollRunsGET(companyId, id),
        apiClient.employeesAll(companyId),
      ]);
      setRun(runResult);
      setEmployees(employeesResult);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "payrollRunDetail.loadError" })));
    }
  }, [companyId, id, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handlePost() {
    if (!companyId || !id) return;
    setPostError(null);
    setPosting(true);
    try {
      await apiClient.post4(companyId, id);
      await refresh();
    } catch (err) {
      setPostError(getApiErrorMessage(err, intl.formatMessage({ id: "payrollRunDetail.postError" })));
    } finally {
      setPosting(false);
    }
  }

  if (!activeCompany || !run) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "payrollRunDetail.title" })}</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const employeeName = (employeeId: string) => employees.find((e) => e.id === employeeId)?.name ?? employeeId;
  const totalGross = run.lines.reduce((sum, l) => sum + l.grossSalary, 0);
  const totalNet = run.lines.reduce((sum, l) => sum + l.netPay, 0);

  return (
    <div className="flex flex-col gap-6">
      <Link className="text-sm text-muted-foreground hover:underline" to="/payroll">
        &larr; {intl.formatMessage({ id: "payrollRunDetail.backToPayroll" })}
      </Link>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {run.periodStart} - {run.periodEnd}
              </CardTitle>
              <CardDescription>{intl.formatMessage({ id: "payrollRunDetail.title" })}</CardDescription>
            </div>
            <Badge variant={run.state === "Posted" ? "default" : "secondary"}>{run.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "payrollRunDetail.employee" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "payrollRunDetail.grossSalary" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "payrollRunDetail.pit" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "payrollRunDetail.employeePension" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "payrollRunDetail.employerPension" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "payrollRunDetail.netPay" })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{employeeName(line.employeeId)}</TableCell>
                  <TableCell className="text-right">{line.grossSalary.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.pitAmount.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.employeePensionAmount.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.employerPensionAmount.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.netPay.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {run.lines.length === 0 && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "payrollRunDetail.noPayslipLines" })}</p>}

          <div className="flex flex-col items-end gap-1 text-sm">
            <p>{intl.formatMessage({ id: "payrollRunDetail.totalGross" }, { amount: totalGross.toFixed(2) })}</p>
            <p className="font-medium">{intl.formatMessage({ id: "payrollRunDetail.totalNetPay" }, { amount: totalNet.toFixed(2) })}</p>
          </div>

          {run.state === "Draft" && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={handlePost} disabled={posting}>
                {posting ? intl.formatMessage({ id: "payrollRunDetail.posting" }) : intl.formatMessage({ id: "payrollRunDetail.postPayrollRun" })}
              </Button>
              {postError && <span className="text-xs text-destructive">{postError}</span>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
