import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, PartnerResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "@/context/CompanyContext";
import { useOpenParam } from "@/hooks/useOpenParam";
import { PartnerRegisterForm, type PartnerRegisterFormFields } from "@/pages/partners/PartnerRegisterForm";

const GRID_ID = "partners";

export function Partners() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [selectedCreateRole, setSelectedCreateRole] = useState<"customer" | "vendor" | undefined>(undefined);
  const [editingId, setEditingId] = useOpenParam();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const partnersQueryKey = ["partners", activeCompanyId] as const;
  const partnersQuery = useQuery({
    queryKey: partnersQueryKey,
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => apiClient.accountsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const partners = useMemo<PartnerResponse[]>(() => partnersQuery.data ?? [], [partnersQuery.data]);
  const accounts = useMemo<AccountResponse[]>(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const accountLabel = (id: string | undefined) => {
    if (!id) return "\u2014";
    const account = accounts.find((a) => a.id === id);
    return account ? `${account.code} \u2014 ${account.name}` : "\u2014";
  };

  const editingPartner = editingId ? partners.find((p) => p.id === editingId) ?? null : null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: partnersQueryKey });
  }

  const createMutation = useMutation({
    mutationFn: async (fields: PartnerRegisterFormFields) => {
      if (!activeCompanyId) throw new Error("no active company");
      return apiClient.partnersPOST(activeCompanyId, {
        name: fields.name,
        taxNumber: fields.taxNumber ?? undefined,
        isCustomer: fields.isCustomer,
        isVendor: fields.isVendor,
        fiscalNumber: fields.fiscalNumber ?? undefined,
        isVatRegistered: fields.isVatRegistered,
        receivableAccountId: fields.receivableAccountId ?? undefined,
        payableAccountId: fields.payableAccountId ?? undefined,
        paymentTermDays: fields.paymentTermDays ?? undefined,
        creditLimit: fields.creditLimit ?? undefined,
        priceListId: fields.priceListId ?? undefined,
        overdueBlockDays: fields.overdueBlockDays ?? undefined,
      });
    },
    onSuccess: async () => {
      setMutationError(null);
      setFormOpen(false);
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "partners.createError" }))),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; fields: PartnerRegisterFormFields }) =>
      apiClient.partnersPUT(activeCompanyId as string, vars.id, {
        name: vars.fields.name,
        taxNumber: vars.fields.taxNumber ?? undefined,
        isCustomer: vars.fields.isCustomer,
        isVendor: vars.fields.isVendor,
        fiscalNumber: vars.fields.fiscalNumber ?? undefined,
        isVatRegistered: vars.fields.isVatRegistered,
        receivableAccountId: vars.fields.receivableAccountId ?? undefined,
        payableAccountId: vars.fields.payableAccountId ?? undefined,
        paymentTermDays: vars.fields.paymentTermDays ?? undefined,
        creditLimit: vars.fields.creditLimit ?? undefined,
        priceListId: vars.fields.priceListId ?? undefined,
        overdueBlockDays: vars.fields.overdueBlockDays ?? undefined,
      }),
    onSuccess: async () => {
      setMutationError(null);
      setEditingId(null);
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "partners.saveError" }))),
  });

  const columns = useMemo<ColumnDef<PartnerResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: intl.formatMessage({ id: "partners.form.name" }),
      },
      {
        id: "type",
        header: intl.formatMessage({ id: "partners.type" }),
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.isCustomer && <Badge variant="secondary">{intl.formatMessage({ id: "partners.form.isCustomer" })}</Badge>}
            {row.original.isVendor && <Badge variant="outline">{intl.formatMessage({ id: "partners.form.isVendor" })}</Badge>}
          </div>
        ),
      },
      {
        id: "vatStatus",
        header: intl.formatMessage({ id: "partnerForm.vatRegistered" }),
        enableSorting: false,
        enableColumnFilter: false,
        accessorFn: (row) =>
          intl.formatMessage({ id: row.isVatRegistered ? "partners.vatRegisteredShort" : "partners.notVatRegisteredShort" }),
        cell: ({ row }) =>
          row.original.isVatRegistered ? (
            <Badge variant="secondary">{intl.formatMessage({ id: "partners.vatRegisteredShort" })}</Badge>
          ) : (
            <span className="text-muted-foreground">{intl.formatMessage({ id: "partners.notVatRegisteredShort" })}</span>
          ),
      },
      {
        accessorKey: "taxNumber",
        header: intl.formatMessage({ id: "partners.form.taxNumber" }),
        cell: ({ getValue }) => (getValue() as string | undefined) || "\u2014",
      },
      {
        accessorKey: "fiscalNumber",
        header: intl.formatMessage({ id: "partners.form.fiscalNumber" }),
        cell: ({ getValue }) => (getValue() as string | undefined) || "\u2014",
      },
      {
        id: "receivableAccount",
        header: intl.formatMessage({ id: "partners.form.receivableAccount" }),
        enableSorting: false,
        accessorFn: (row) => accountLabel(row.receivableAccountId),
      },
      {
        id: "payableAccount",
        header: intl.formatMessage({ id: "partners.form.payableAccount" }),
        enableSorting: false,
        accessorFn: (row) => accountLabel(row.payableAccountId),
      },
      {
        accessorKey: "paymentTermDays",
        header: intl.formatMessage({ id: "partners.form.paymentTermDays" }),
        meta: { numeric: true },
        cell: ({ getValue }) => { const v = getValue(); return typeof v === "number" ? v : "\u2014"; },
      },
      {
        accessorKey: "creditLimit",
        header: intl.formatMessage({ id: "partners.form.creditLimit" }),
        meta: { numeric: true },
        cell: ({ getValue }) => { const v = getValue(); return typeof v === "number" ? `${v.toFixed(2)} \u20AC` : "\u2014"; },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            disabled={editingId !== null && editingId !== row.original.id}
            onClick={() => {
              setEditingId(row.original.id);
              setFormOpen(false);
              setMutationError(null);
            }}
          >
            {intl.formatMessage({ id: "common.edit" })}
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, accounts, editingId],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = partnersQuery.isError ? getApiErrorMessage(partnersQuery.error, intl.formatMessage({ id: "partners.loadError" })) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "partners.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "partners.description" })}</p>
        </div>
        <Button
          onClick={() => {
            setRolePickerOpen(true);
            setEditingId(null);
            setMutationError(null);
          }}
        >
          {intl.formatMessage({ id: "partners.addPartner" })}
        </Button>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {/* Role picker — ask Customer or Vendor first */}
      <Dialog open={rolePickerOpen} onOpenChange={setRolePickerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "partners.form.selectRole" })}</DialogTitle>
            <DialogDescription>{intl.formatMessage({ id: "partners.form.selectRoleDescription" })}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button className="flex-1" variant="outline" onClick={() => { setSelectedCreateRole("customer"); setRolePickerOpen(false); setFormOpen(true); }}>
              {intl.formatMessage({ id: "partners.form.isCustomer" })}
            </Button>
            <Button className="flex-1" variant="outline" onClick={() => { setSelectedCreateRole("vendor"); setRolePickerOpen(false); setFormOpen(true); }}>
              {intl.formatMessage({ id: "partners.form.isVendor" })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "partners.addPartner" })}</CardTitle>
          </CardHeader>
          <CardContent>
            <PartnerRegisterForm
              mode="create"
              accounts={accounts}
              submitting={createMutation.isPending}
              error={mutationError}
              defaultRole={selectedCreateRole}
              onSubmit={(fields) => createMutation.mutate(fields)}
              onCancel={() => {
                setFormOpen(false);
                setMutationError(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      {editingPartner && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "partners.editPartner" }, { name: editingPartner.name })}</CardTitle>
          </CardHeader>
          <CardContent>
            <PartnerRegisterForm
              key={editingPartner.id}
              mode="edit"
              accounts={accounts}
              initial={editingPartner}
              submitting={updateMutation.isPending}
              error={mutationError}
              onSubmit={(fields) => updateMutation.mutate({ id: editingPartner.id, fields })}
              onCancel={() => {
                setEditingId(null);
                setMutationError(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={partners}
        rowCount={partners.length}
        isLoading={partnersQuery.isPending}
        getRowId={(row) => row.id}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "partners.searchPlaceholder" })}
        emptyMessage={intl.formatMessage({ id: "partners.noPartners" })}
        exportFileName="partners"
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={100}
        pageSizeOptions={[50, 100, 200]}
      />
    </div>
  );
}
