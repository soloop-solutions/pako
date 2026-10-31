import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { StatutoryParameterResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Mirrors StatutoryParameterKeys on the backend. Rates are stored as fractions (0.05) but typed
// and shown as percentages; the server validates the stored value either way.
const STATUTORY_KEYS = [
  "MinimumWage",
  "PensionEmployeeRate",
  "PensionEmployerRate",
  "PitBand1UpperAnnual",
  "PitBand2UpperAnnual",
  "PitRate1",
  "PitRate2",
  "PitRate3",
  "SecondaryEmployerRate",
  "OvertimeMultiplier",
  "NightWorkPremium",
  "WeekendWorkPremium",
  "HolidayWorkPremium",
  "StandardWeeklyHours",
] as const;

const RATE_KEYS = new Set<string>([
  "PensionEmployeeRate",
  "PensionEmployerRate",
  "PitRate1",
  "PitRate2",
  "PitRate3",
  "SecondaryEmployerRate",
  "NightWorkPremium",
  "WeekendWorkPremium",
  "HolidayWorkPremium",
]);

const isRateKey = (key: string) => RATE_KEYS.has(key);

interface StatutoryParametersSettingsProps {
  firmId: string;
}

// C5: the Kosovo defaults (read-only, from code) and the firm's dated overrides. A new value
// applies from its date to payroll runs created afterwards; existing runs keep their snapshot.
export function StatutoryParametersSettings({ firmId }: StatutoryParametersSettingsProps) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const queryKey = ["statutoryParameters", firmId] as const;

  const [key, setKey] = useState<string>(STATUTORY_KEYS[0]);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parametersQuery = useQuery({ queryKey, queryFn: () => apiClient.listStatutoryParameters(firmId) });

  const createMutation = useMutation({
    mutationFn: () => {
      const typed = Number(value.replace(",", "."));
      return apiClient.createStatutoryParameter(firmId, {
        key,
        effectiveFrom,
        value: isRateKey(key) ? typed / 100 : typed,
        source: source.trim() || undefined,
      });
    },
    onSuccess: () => {
      setValue("");
      setSource("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "statutory.saveError" }))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteStatutoryParameter(firmId, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "statutory.deleteError" }))),
  });

  const keyLabel = (k: string) => intl.formatMessage({ id: `statutory.key.${k}` });
  const formatValue = (row: StatutoryParameterResponse) =>
    isRateKey(row.key)
      ? `${intl.formatNumber(row.value * 100, { maximumFractionDigits: 4 })}%`
      : intl.formatNumber(row.value, { maximumFractionDigits: 4 });

  const columns = useMemo<ColumnDef<StatutoryParameterResponse>[]>(
    () => [
      {
        accessorKey: "key",
        header: intl.formatMessage({ id: "statutory.column.key" }),
        enableGrouping: true,
        meta: { groupable: true },
        cell: ({ getValue }) => keyLabel(getValue() as string),
      },
      { accessorKey: "effectiveFrom", header: intl.formatMessage({ id: "statutory.column.effectiveFrom" }) },
      {
        accessorKey: "value",
        header: intl.formatMessage({ id: "statutory.column.value" }),
        meta: { numeric: true },
        cell: ({ row }) => <span className="tabular-nums">{formatValue(row.original)}</span>,
      },
      {
        id: "origin",
        header: intl.formatMessage({ id: "statutory.column.origin" }),
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Badge variant={row.original.isOverride ? "default" : "secondary"}>
              {intl.formatMessage({ id: row.original.isOverride ? "statutory.origin.firm" : "statutory.origin.default" })}
            </Badge>
            {row.original.needsVerification && (
              <Badge variant="outline">{intl.formatMessage({ id: "statutory.needsVerification" })}</Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: "source",
        header: intl.formatMessage({ id: "statutory.column.source" }),
        cell: ({ getValue }) => (getValue() as string | undefined) || "—",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.id ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm(intl.formatMessage({ id: "statutory.confirmDelete" }, { key: keyLabel(row.original.key), date: row.original.effectiveFrom }))) {
                  deleteMutation.mutate(row.original.id!);
                }
              }}
            >
              {intl.formatMessage({ id: "common.delete" })}
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, deleteMutation.isPending],
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!effectiveFrom || value.trim() === "" || Number.isNaN(Number(value.replace(",", ".")))) {
      setError(intl.formatMessage({ id: "statutory.validation" }));
      return;
    }
    createMutation.mutate();
  }

  const rows = parametersQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "statutory.title" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "statutory.description" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form className="grid gap-3 sm:grid-cols-5 sm:items-end" onSubmit={handleSubmit} aria-label={intl.formatMessage({ id: "statutory.addTitle" })}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statutory-key">{intl.formatMessage({ id: "statutory.column.key" })}</Label>
            <select
              id="statutory-key"
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            >
              {STATUTORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {keyLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statutory-from">{intl.formatMessage({ id: "statutory.column.effectiveFrom" })}</Label>
            <Input id="statutory-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statutory-value">
              {intl.formatMessage({ id: "statutory.column.value" })}
              {isRateKey(key) ? " (%)" : ""}
            </Label>
            <Input id="statutory-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statutory-source">{intl.formatMessage({ id: "statutory.column.source" })}</Label>
            <Input id="statutory-source" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <Button type="submit" disabled={createMutation.isPending}>
            {intl.formatMessage({ id: "statutory.add" })}
          </Button>
        </form>
        <DataGrid
          gridId="statutory-parameters"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={parametersQuery.isPending}
          getRowId={(row) => row.id ?? `${row.key}-${row.effectiveFrom}-default`}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
          defaultPageSize={100}
        />
      </CardContent>
    </Card>
  );
}
