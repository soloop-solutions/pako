import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { AnnualEmployeeStatementMonth } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const YEAR_PARAM = "year";
const YEARS_BACK = 6;

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * Annual income statement (Kosovo employers hand one to each employee by 31 March). Every amount,
 * totals included, renders exactly as the API returns it.
 */
export function EmployeeAnnualStatement({ companyId, employeeId }: { companyId: string; employeeId: string }) {
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(searchParams.get(YEAR_PARAM)) || thisYear;
  const years = Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i);
  if (!years.includes(year)) years.push(year);

  const statementQuery = useQuery({
    queryKey: ["employeeStatement", companyId, employeeId, year],
    queryFn: () => apiClient.getAnnualEmployeeStatement(companyId, employeeId, year),
  });
  const statement = statementQuery.data;

  const columns = useMemo<ColumnDef<AnnualEmployeeStatementMonth>[]>(() => {
    const amount = (key: keyof AnnualEmployeeStatementMonth, labelId: string): ColumnDef<AnnualEmployeeStatementMonth> => ({
      id: key as string,
      accessorFn: (row) => row[key] as number,
      header: intl.formatMessage({ id: labelId }),
      enableColumnFilter: false,
      meta: { numeric: true },
      cell: ({ getValue }) => money(getValue() as number),
    });
    return [
      {
        id: "month",
        accessorKey: "periodStart",
        header: intl.formatMessage({ id: "hr.statement.month" }),
        enableColumnFilter: false,
        cell: ({ row }) => {
          // periodStart is a date-only "YYYY-MM-DD"; read it without timezone shifting.
          const [y, m] = row.original.periodStart.split("-").map(Number);
          return intl.formatDate(new Date(y, (m ?? 1) - 1, 1), { month: "long", year: "numeric" });
        },
      },
      amount("grossSalary", "hr.statement.gross"),
      amount("employeePension", "hr.statement.employeePension"),
      amount("employerPension", "hr.statement.employerPension"),
      amount("pit", "hr.statement.pit"),
      amount("netPay", "hr.statement.netPay"),
    ];
  }, [intl]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="statement-year">{intl.formatMessage({ id: "hr.statement.year" })}</Label>
          <Select
            id="statement-year"
            className="w-28"
            value={String(year)}
            onValueChange={(v) =>
              setSearchParams(
                (prev) => {
                  const params = new URLSearchParams(prev);
                  params.set(YEAR_PARAM, v);
                  return params;
                },
                { replace: true },
              )
            }
            options={years.map((y) => ({
              value: String(y),
              label: String(y),
            }))}
          />
        </div>
        <p className="pb-1 text-xs text-muted-foreground">{intl.formatMessage({ id: "hr.statement.hint" })}</p>
      </div>

      {statementQuery.isError && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(statementQuery.error, intl.formatMessage({ id: "hr.statement.loadError" }))}</AlertDescription>
        </Alert>
      )}

      <DataGrid
        gridId="employeeStatement"
        columns={columns}
        data={statement?.months ?? []}
        rowCount={statement?.months.length ?? 0}
        isLoading={statementQuery.isPending}
        getRowId={(row) => row.periodStart}
        emptyMessage={intl.formatMessage({ id: "hr.statement.empty" }, { year })}
        exportFileName={`statement-${year}`}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={50}
      />

      {statement && statement.months.length > 0 && (
        <dl
          className="grid grid-cols-2 gap-x-6 gap-y-1 self-end rounded-md border bg-totals px-4 py-2 text-sm text-totals-foreground sm:grid-cols-5"
          data-testid="statement-totals"
        >
          {(
            [
              ["hr.statement.gross", statement.totalGross],
              ["hr.statement.employeePension", statement.totalEmployeePension],
              ["hr.statement.employerPension", statement.totalEmployerPension],
              ["hr.statement.pit", statement.totalPit],
              ["hr.statement.netPay", statement.totalNetPay],
            ] as const
          ).map(([labelId, value]) => (
            <div key={labelId} className="flex flex-col items-end">
              <dt className="text-xs text-muted-foreground">
                {intl.formatMessage({ id: "hr.statement.totalOf" }, { label: intl.formatMessage({ id: labelId }) })}
              </dt>
              <dd className="font-semibold tabular-nums">{money(value)} €</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
