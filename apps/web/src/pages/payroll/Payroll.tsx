import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { EmployeeResponse, PayrollRunResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function endOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export function Payroll() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [employees, setEmployees] = useState<EmployeeResponse[]>([]);
  const [runs, setRuns] = useState<PayrollRunResponse[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [employeeName, setEmployeeName] = useState("");
  const [employeeSalary, setEmployeeSalary] = useState("");
  const [employeeError, setEmployeeError] = useState<string | null>(null);
  const [creatingEmployee, setCreatingEmployee] = useState(false);

  const [periodStart, setPeriodStart] = useState(startOfMonth);
  const [periodEnd, setPeriodEnd] = useState(endOfMonth);
  const [runError, setRunError] = useState<string | null>(null);
  const [creatingRun, setCreatingRun] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [employeesResult, runsResult] = await Promise.all([
        apiClient.employeesAll(companyId),
        apiClient.payrollRunsAll(companyId),
      ]);
      setEmployees(employeesResult);
      setRuns(runsResult);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreateEmployee(event: FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setEmployeeError(null);
    setCreatingEmployee(true);
    try {
      await apiClient.employees(companyId, {
        name: employeeName.trim(),
        monthlyGrossSalary: parseFloat(employeeSalary) || 0,
      });
      setEmployeeName("");
      setEmployeeSalary("");
      await refresh();
    } catch (err) {
      setEmployeeError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.createEmployeeError" })));
    } finally {
      setCreatingEmployee(false);
    }
  }

  async function handleCreateRun(event: FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setRunError(null);
    setCreatingRun(true);
    try {
      await apiClient.payrollRunsPOST(companyId, { periodStart, periodEnd });
      await refresh();
    } catch (err) {
      setRunError(getApiErrorMessage(err, intl.formatMessage({ id: "payroll.createRunError" })));
    } finally {
      setCreatingRun(false);
    }
  }

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "payroll.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "payroll.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "payroll.employees" })}</CardTitle>
          <CardDescription>{activeCompany.name}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleCreateEmployee}>
            {employeeError && (
              <Alert variant="destructive" className="sm:basis-full">
                <AlertDescription>{employeeError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="employee-name">{intl.formatMessage({ id: "payroll.employeeName" })}</Label>
              <Input id="employee-name" required value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="employee-salary">{intl.formatMessage({ id: "payroll.monthlyGrossSalary" })}</Label>
              <Input
                id="employee-salary"
                type="number"
                step="0.01"
                min="0"
                required
                value={employeeSalary}
                onChange={(event) => setEmployeeSalary(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={creatingEmployee || employeeName.trim().length === 0}>
              {creatingEmployee ? intl.formatMessage({ id: "payroll.adding" }) : intl.formatMessage({ id: "payroll.addEmployee" })}
            </Button>
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "common.name" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "payroll.monthlyGrossSalary" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "common.active" })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell>{employee.name}</TableCell>
                  <TableCell className="text-right">{employee.monthlyGrossSalary.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={employee.isActive ? "default" : "secondary"}>
                      {employee.isActive ? intl.formatMessage({ id: "common.active" }) : intl.formatMessage({ id: "common.inactive" })}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {employees.length === 0 && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "payroll.noEmployees" })}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "payroll.newPayrollRun" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "payroll.newPayrollRunDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleCreateRun}>
            {runError && (
              <Alert variant="destructive" className="sm:basis-full">
                <AlertDescription>{runError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="run-period-start">{intl.formatMessage({ id: "payroll.periodStart" })}</Label>
              <Input
                id="run-period-start"
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="run-period-end">{intl.formatMessage({ id: "payroll.periodEnd" })}</Label>
              <Input
                id="run-period-end"
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={creatingRun}>
              {creatingRun ? intl.formatMessage({ id: "payroll.creatingRun" }) : intl.formatMessage({ id: "payroll.createPayrollRun" })}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "payroll.payrollRuns" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "payroll.period" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "payroll.state" })}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    {run.periodStart} - {run.periodEnd}
                  </TableCell>
                  <TableCell>
                    <Badge variant={run.state === "Posted" ? "default" : "secondary"}>{run.state}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link className="text-sm font-medium text-primary hover:underline" to={`/payroll/${run.id}`}>
                      {intl.formatMessage({ id: "common.view" })}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {runs.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "payroll.noPayrollRuns" })}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
