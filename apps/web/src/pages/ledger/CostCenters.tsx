import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { CostCenterResponse, SaveCostCenterRequest } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";

const GRID_ID = "costCenters";

// 40_Cost_Centers register. Departments point at one, so their payroll expense is tagged with it.
// No delete: posted journal lines may already carry a cost center.
export function CostCenters() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const readOnly = !canWrite("accounting");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const queryKey = ["costCenters", activeCompanyId] as const;
  const costCentersQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.listCostCenters(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const costCenters = useMemo(() => costCentersQuery.data ?? [], [costCentersQuery.data]);
  const editing = editingId ? costCenters.find((c) => c.id === editingId) ?? null : null;

  function closeForms() {
    setFormOpen(false);
    setEditingId(null);
    setMutationError(null);
  }

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string | null; request: SaveCostCenterRequest }) =>
      vars.id
        ? apiClient.updateCostCenter(activeCompanyId as string, vars.id, vars.request)
        : apiClient.createCostCenter(activeCompanyId as string, vars.request),
    onSuccess: async () => {
      toast.success(intl.formatMessage({ id: "toast.costCenterSaved" }));
      closeForms();
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "costCenters.saveError" }))),
  });

  const columns = useMemo<ColumnDef<CostCenterResponse>[]>(
    () => [
      { accessorKey: "code", header: intl.formatMessage({ id: "common.code" }) },
      { accessorKey: "name", header: intl.formatMessage({ id: "common.name" }) },
      { accessorKey: "nameEn", header: intl.formatMessage({ id: "costCenters.nameEn" }) },
    ],
    [intl],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = costCentersQuery.isError
    ? getApiErrorMessage(costCentersQuery.error, intl.formatMessage({ id: "costCenters.loadError" }))
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "nav.costCenters" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "nav.costCenters.description" })}</p>
        </div>
        {!readOnly && (
          <Button
            onClick={() => {
              setFormOpen((open) => !open);
              setEditingId(null);
              setMutationError(null);
            }}
          >
            {intl.formatMessage({ id: "costCenters.new" })}
          </Button>
        )}
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {((formOpen && !editing) || editing) && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editing ? intl.formatMessage({ id: "costCenters.edit" }, { code: editing.code }) : intl.formatMessage({ id: "costCenters.new" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CostCenterForm
              key={editing?.id ?? "new"}
              initial={editing}
              submitting={saveMutation.isPending}
              error={mutationError}
              onSubmit={(request) => saveMutation.mutate({ id: editing?.id ?? null, request })}
              onCancel={closeForms}
            />
          </CardContent>
        </Card>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={costCenters}
        rowCount={costCenters.length}
        isLoading={costCentersQuery.isPending}
        getRowId={(row) => row.id}
        onRowClick={
          readOnly
            ? undefined
            : (row) => {
                setEditingId(row.id);
                setFormOpen(false);
                setMutationError(null);
              }
        }
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "costCenters.searchPlaceholder" })}
        emptyMessage={intl.formatMessage({ id: "costCenters.empty" })}
        exportFileName="cost-centers"
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={100}
        pageSizeOptions={[50, 100, 200]}
      />
    </div>
  );
}

function CostCenterForm({
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial: CostCenterResponse | null;
  submitting: boolean;
  error: string | null;
  onSubmit: (request: SaveCostCenterRequest) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [nameEn, setNameEn] = useState(initial && initial.nameEn !== initial.name ? initial.nameEn : "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ code: code.trim(), name: name.trim(), nameEn: nameEn.trim() || undefined });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cost-center-code">{intl.formatMessage({ id: "common.code" })}</Label>
          <Input id="cost-center-code" required maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cost-center-name">{intl.formatMessage({ id: "common.name" })}</Label>
          <Input id="cost-center-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cost-center-name-en">{intl.formatMessage({ id: "costCenters.nameEn" })}</Label>
          <Input
            id="cost-center-name-en"
            placeholder={intl.formatMessage({ id: "costCenters.nameEnHint" })}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {intl.formatMessage({ id: "common.save" })}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
      </div>
    </form>
  );
}
