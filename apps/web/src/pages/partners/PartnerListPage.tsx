import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, PartnerResponse } from "@pako/shared";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/data-grid/DataGrid";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { useOpenParam } from "@/hooks/useOpenParam";
import { PartnerRegisterForm, type PartnerRegisterFormFields } from "@/pages/partners/PartnerRegisterForm";

export interface PartnerListPageLabels {
  titleKey: string;
  descriptionKey: string;
  addButtonKey: string;
  editTitleKey: string;
  createdKey: string;
  savedKey: string;
  createErrorKey: string;
  saveErrorKey: string;
  loadErrorKey: string;
  emptyKey: string;
  searchPlaceholderKey: string;
}

interface PartnerListPageProps {
  gridId: string;
  labels: PartnerListPageLabels;
  /** Filter partners for this list. Omit to show all. */
  filterFn?: (partner: PartnerResponse) => boolean;
  /** Default role when creating from this page. */
  defaultRole?: "customer" | "vendor";
  /** Show the Type column with Customer/Vendor badges. Defaults to true. */
  showTypeColumn?: boolean;
  /** Column ids to hide from the grid (e.g. hide payable columns on the Customers page). */
  hiddenColumnIds?: string[];
  exportFileName: string;
}

export function PartnerListPage({
  gridId,
  labels,
  filterFn,
  defaultRole,
  showTypeColumn = true,
  hiddenColumnIds,
  exportFileName,
}: PartnerListPageProps) {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [selectedCreateRole, setSelectedCreateRole] = useState<"customer" | "vendor" | undefined>(defaultRole);
  const [editingId, setEditingId] = useOpenParam();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

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

  const allPartners = useMemo<PartnerResponse[]>(
    () => partnersQuery.data ?? [],
    [partnersQuery.data],
  );
  const partners = useMemo(
    () => (filterFn ? allPartners.filter(filterFn) : allPartners),
    [allPartners, filterFn],
  );
  const accounts = useMemo<AccountResponse[]>(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const getAccountLabel = (id: string | undefined) => {
    if (!id) return "\u2014";
    const account = accounts.find((a) => a.id === id);
    return account ? `${account.code} \u2014 ${account.name}` : "\u2014";
  };

  const editingPartner =
    editingId ? (allPartners.find((p) => p.id === editingId) ?? null) : null;

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
      });
    },
    onSuccess: async () => {
      setMutationError(null);
      setDirty(false);
      setFormOpen(false);
      toast.success(intl.formatMessage({ id: labels.createdKey }));
      await refresh();
    },
    onError: (err: unknown) =>
      setMutationError(
        getApiErrorMessage(err, intl.formatMessage({ id: labels.createErrorKey })),
      ),
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
      }),
    onSuccess: async () => {
      setMutationError(null);
      setDirty(false);
      setEditingId(null);
      toast.success(intl.formatMessage({ id: labels.savedKey }));
      await refresh();
    },
    onError: (err: unknown) =>
      setMutationError(
        getApiErrorMessage(err, intl.formatMessage({ id: labels.saveErrorKey })),
      ),
  });

  /* eslint-disable react-hooks/exhaustive-deps */
  const columns = useMemo<ColumnDef<PartnerResponse>[]>(() => {
    const hidden = new Set(hiddenColumnIds ?? []);
    const cols: ColumnDef<PartnerResponse>[] = [
      { accessorKey: "name", header: intl.formatMessage({ id: "partners.form.name" }) },
    ];

    if (showTypeColumn) {
      cols.push({
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
      });
    }

    // When viewing a role-specific list (Customers or Vendors), show a subtle indicator
    // for partners that also have the other role.
    if (defaultRole === "customer") {
      cols.push({
        id: "alsoVendor",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.isVendor
            ? <Badge variant="outline" className="text-muted-foreground text-[10px]">{intl.formatMessage({ id: "partners.alsoVendor" })}</Badge>
            : null,
      });
    } else if (defaultRole === "vendor") {
      cols.push({
        id: "alsoCustomer",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.isCustomer
            ? <Badge variant="outline" className="text-muted-foreground text-[10px]">{intl.formatMessage({ id: "partners.alsoCustomer" })}</Badge>
            : null,
      });
    }

    cols.push(
      {
        id: "vatStatus",
        header: intl.formatMessage({ id: "partnerForm.vatRegistered" }),
        enableSorting: false,
        enableColumnFilter: false,
        accessorFn: (row) =>
          intl.formatMessage({ id: row.isVatRegistered ? "partners.vatRegisteredShort" : "partners.notVatRegisteredShort" }),
        cell: ({ row }) =>
          row.original.isVatRegistered
            ? <Badge variant="secondary">{intl.formatMessage({ id: "partners.vatRegisteredShort" })}</Badge>
            : <span className="text-muted-foreground">{intl.formatMessage({ id: "partners.notVatRegisteredShort" })}</span>,
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
        accessorFn: (row) => getAccountLabel(row.receivableAccountId),
      },
      {
        id: "payableAccount",
        header: intl.formatMessage({ id: "partners.form.payableAccount" }),
        enableSorting: false,
        accessorFn: (row) => getAccountLabel(row.payableAccountId),
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
            onClick={() => { setEditingId(row.original.id); setFormOpen(false); setMutationError(null); setDirty(false); }}
          >
            {intl.formatMessage({ id: "common.edit" })}
          </Button>
        ),
      },
    );

    return hidden.size > 0
      ? cols.filter((c) => {
          const id = "id" in c ? c.id : "accessorKey" in c ? String(c.accessorKey) : undefined;
          return !id || !hidden.has(id);
        })
      : cols;
  }, [intl, accounts, editingId, showTypeColumn, defaultRole]);
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = partnersQuery.isError
    ? getApiErrorMessage(partnersQuery.error, intl.formatMessage({ id: labels.loadErrorKey }))
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: labels.titleKey })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: labels.descriptionKey })}</p>
        </div>
        <Button onClick={() => {
          if (!defaultRole) {
            setRolePickerOpen(true);
          } else {
            setSelectedCreateRole(defaultRole);
            setFormOpen(true);
          }
          setEditingId(null); setMutationError(null); setDirty(false);
        }}>
          {intl.formatMessage({ id: labels.addButtonKey })}
        </Button>
      </div>

      {loadError && (
        <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>
      )}

      {/* Role picker — shown when creating from the generic /partners page */}
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

      <FormDialog
        open={formOpen}
        onOpenChange={(open) => { if (!open) { setFormOpen(false); setMutationError(null); setDirty(false); } }}
        title={intl.formatMessage({ id: labels.addButtonKey })}
        size="md"
        dirty={dirty}
      >
        <PartnerRegisterForm
          mode="create"
          accounts={accounts}
          submitting={createMutation.isPending}
          error={mutationError}
          onSubmit={(fields) => createMutation.mutate(fields)}
          onCancel={() => { setFormOpen(false); setMutationError(null); setDirty(false); }}
          defaultRole={selectedCreateRole}
          createButtonLabelKey={labels.addButtonKey}
          onDirtyChange={setDirty}
        />
      </FormDialog>

      <FormDialog
        open={editingPartner !== null}
        onOpenChange={(open) => { if (!open) { setEditingId(null); setMutationError(null); setDirty(false); } }}
        title={editingPartner ? intl.formatMessage({ id: labels.editTitleKey }, { name: editingPartner.name }) : ""}
        size="md"
        dirty={dirty}
      >
        {editingPartner && (
          <PartnerRegisterForm
            key={editingPartner.id}
            mode="edit"
            accounts={accounts}
            initial={editingPartner}
            submitting={updateMutation.isPending}
            error={mutationError}
            onSubmit={(fields) => updateMutation.mutate({ id: editingPartner.id, fields })}
            onCancel={() => { setEditingId(null); setMutationError(null); setDirty(false); }}
            onDirtyChange={setDirty}
          />
        )}
      </FormDialog>

      <DataGrid
        gridId={gridId}
        columns={columns}
        data={partners}
        rowCount={partners.length}
        isLoading={partnersQuery.isPending}
        getRowId={(row) => row.id}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: labels.searchPlaceholderKey })}
        emptyMessage={intl.formatMessage({ id: labels.emptyKey })}
        exportFileName={exportFileName}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={100}
        pageSizeOptions={[50, 100, 200]}
      />
    </div>
  );
}
