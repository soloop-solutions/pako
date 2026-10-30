import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { PartnerStatementLine } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompany } from "@/context/CompanyContext";
import { formatAmount } from "@/lib/payroll-enums";

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// J15: one partner's account statement — opening balance, every receivable/payable movement,
// closing balance. Partner-restricted staff see only their assigned partners (the API enforces it).
// Every figure, running balance included, is the API's.
export function PartnerStatement() {
  const intl = useIntl();
  const { activeCompanyId: companyId } = useCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerId = searchParams.get("partner") ?? "";
  const from = searchParams.get("from") ?? yearStart();
  const to = searchParams.get("to") ?? today();

  function setParam(key: string, value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set(key, value);
        else params.delete(key);
        return params;
      },
      { replace: true },
    );
  }

  const partnersQuery = useQuery({
    queryKey: ["partners", companyId],
    queryFn: () => apiClient.partnersAll(companyId as string),
    enabled: !!companyId,
  });
  const statementQuery = useQuery({
    queryKey: ["partnerStatement", companyId, partnerId, from, to],
    queryFn: () => apiClient.getPartnerStatement(companyId as string, partnerId, from, to),
    enabled: !!companyId && !!partnerId && !!from && !!to,
  });

  const columns = useMemo<ColumnDef<PartnerStatementLine>[]>(
    () => [
      { accessorKey: "date", header: intl.formatMessage({ id: "expenses.line.date" }) },
      { accessorKey: "reference", header: intl.formatMessage({ id: "commission.basis.document" }), cell: ({ getValue }) => (getValue() as string) || "—" },
      { accessorKey: "description", header: intl.formatMessage({ id: "payroll.adjustment.description" }), cell: ({ getValue }) => (getValue() as string) || "—" },
      { accessorKey: "accountCode", header: intl.formatMessage({ id: "statement.account" }) },
      { accessorKey: "debit", header: intl.formatMessage({ id: "statement.debit" }), meta: { numeric: true }, cell: ({ getValue }) => ((getValue() as number) ? formatAmount(getValue() as number) : "") },
      { accessorKey: "credit", header: intl.formatMessage({ id: "statement.credit" }), meta: { numeric: true }, cell: ({ getValue }) => ((getValue() as number) ? formatAmount(getValue() as number) : "") },
      { accessorKey: "balance", header: intl.formatMessage({ id: "statement.balance" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    [intl],
  );

  if (!companyId) return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  const statement = statementQuery.data;
  const lines = statement?.lines ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "nav.partnerStatement" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "nav.partnerStatement.description" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label>{intl.formatMessage({ id: "commission.basis.partner" })}</Label>
            <SearchableSelect
              value={partnerId}
              onChange={(v) => setParam("partner", v)}
              placeholder={intl.formatMessage({ id: "statement.choosePartner" })}
              options={(partnersQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statement-from">{intl.formatMessage({ id: "me.leave.from" })}</Label>
            <Input id="statement-from" type="date" value={from} onChange={(e) => setParam("from", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statement-to">{intl.formatMessage({ id: "me.leave.to" })}</Label>
            <Input id="statement-to" type="date" value={to} onChange={(e) => setParam("to", e.target.value)} />
          </div>
        </div>

        {statementQuery.isError && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(statementQuery.error, intl.formatMessage({ id: "statement.loadError" }))}</AlertDescription>
          </Alert>
        )}

        {statement && (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {(
              [
                ["statement.opening", statement.openingBalance],
                ["statement.debit", statement.totalDebit],
                ["statement.credit", statement.totalCredit],
                ["statement.closing", statement.closingBalance],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded-md border px-3 py-2">
                <div className="text-xs text-muted-foreground">{intl.formatMessage({ id: key })}</div>
                <div className="font-semibold tabular-nums">{formatAmount(value)}</div>
              </div>
            ))}
          </div>
        )}

        {partnerId ? (
          <DataGrid
            gridId="partner-statement"
            columns={columns}
            data={lines}
            rowCount={lines.length}
            isLoading={statementQuery.isPending}
            getRowId={(row, i) => `${row.date}-${i}`}
            emptyMessage={intl.formatMessage({ id: "statement.empty" })}
            exportFileName={`statement-${statement?.partnerName ?? "partner"}-${from}-${to}`}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "statement.choosePartner" })}</p>
        )}
      </CardContent>
    </Card>
  );
}
