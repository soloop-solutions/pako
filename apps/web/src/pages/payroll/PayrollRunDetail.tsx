import { useCallback, useEffect, useState } from "react";
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
      setError(getApiErrorMessage(err, "Could not load the payroll run."));
    }
  }, [companyId, id]);

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
      setPostError(getApiErrorMessage(err, "Could not post this payroll run."));
    } finally {
      setPosting(false);
    }
  }

  if (!activeCompany || !run) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Payroll run</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">Loading...</p>
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
        &larr; Back to payroll
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
              <CardDescription>Payroll run</CardDescription>
            </div>
            <Badge variant={run.state === "Posted" ? "default" : "secondary"}>{run.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Gross salary</TableHead>
                <TableHead className="text-right">PIT</TableHead>
                <TableHead className="text-right">Employee pension</TableHead>
                <TableHead className="text-right">Employer pension</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
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
          {run.lines.length === 0 && <p className="text-sm text-muted-foreground">No payslip lines.</p>}

          <div className="flex flex-col items-end gap-1 text-sm">
            <p>Total gross: {totalGross.toFixed(2)}</p>
            <p className="font-medium">Total net pay: {totalNet.toFixed(2)}</p>
          </div>

          {run.state === "Draft" && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={handlePost} disabled={posting}>
                {posting ? "Posting..." : "Post payroll run"}
              </Button>
              {postError && <span className="text-xs text-destructive">{postError}</span>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
