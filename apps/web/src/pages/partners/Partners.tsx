import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { updatePartnerV2 } from "@/api/partners-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useCompany } from "@/context/CompanyContext";
import type { PartnerV2 } from "@/lib/partners";
import { ensureAccountsMockWorkerStarted } from "@/mocks/mockInit";
import { setPartnerMockFields, setPartnersMockActive } from "@/mocks/partnersMockFlag";
import { PartnerRegisterForm, type PartnerRegisterFormFields } from "@/pages/partners/PartnerRegisterForm";

const GRID_ID = "partners";

export function Partners() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Mount-scoped mock — same synchronous-flag discipline as F2 (src/mocks/accountsMockFlag.ts),
  // F3 and F5: the F6 mock only answers real partner requests while this screen is actually on
  // screen, and the flag flip itself must stay perfectly synchronous with the effect (no async
  // work before it) to close the route-transition race documented on accountsMockFlag.ts.
  const [mockReady, setMockReady] = useState(false);
  useEffect(() => {
    setPartnersMockActive(true);
    let cancelled = false;
    void ensureAccountsMockWorkerStarted().then(() => {
      if (!cancelled) setMockReady(true);
    });
    return () => {
      cancelled = true;
      setMockReady(false);
      setPartnersMockActive(false);
    };
  }, []);

  const partnersQueryKey = ["partnersV2", activeCompanyId] as const;
  const partnersQuery = useQuery({
    queryKey: partnersQueryKey,
    queryFn: async () => {
      // GET .../partners is the real generated client method — the F6 mock intercepts this exact
      // URL and splices the 3 mocked fields onto the real response. See
      // src/mocks/partnersHandlers.ts.
      const result = await apiClient.partnersAll(activeCompanyId as string);
      return result as unknown as PartnerV2[];
    },
    enabled: !!activeCompanyId && mockReady,
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => apiClient.accountsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const partners = useMemo(() => partnersQuery.data ?? [], [partnersQuery.data]);
  const accounts = useMemo<AccountResponse[]>(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const accountLabel = (id: string | null) => {
    if (!id) return "—";
    const account = accounts.find((a) => a.id === id);
    return account ? `${account.code} — ${account.name}` : "—";
  };

  const editingPartner = editingId ? partners.find((p) => p.id === editingId) ?? null : null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: partnersQueryKey });
  }

  const createMutation = useMutation({
    mutationFn: async (fields: PartnerRegisterFormFields) => {
      if (!activeCompanyId) throw new Error("no active company");
      // The 6 real fields go through the real generated POST. See
      // src/pages/partners/PartnerRegisterForm.tsx for why controlAccountId/paymentTermDays/
      // creditLimit are MOCKED, stored separately right after the real create call succeeds —
      // same technique src/mocks/itemTypesMockFlag.ts established for F5's item type.
      const created = await apiClient.partnersPOST(activeCompanyId, {
        name: fields.name,
        taxNumber: fields.taxNumber ?? undefined,
        isCustomer: fields.isCustomer,
        isVendor: fields.isVendor,
        fiscalNumber: fields.fiscalNumber ?? undefined,
        isVatRegistered: fields.isVatRegistered,
      });
      setPartnerMockFields(created.id, {
        controlAccountId: fields.controlAccountId,
        paymentTermDays: fields.paymentTermDays,
        creditLimit: fields.creditLimit,
      });
      return created;
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
      // No real edit endpoint exists at all (PartnersController has only GET/POST) — every field,
      // real or mocked, goes through the fully mocked PUT here. See
      // src/mocks/partnersHandlers.ts's header for why this is a different real/mock split shape
      // than F5's item-type mock. Code review caught that an edited real field (name/taxNumber/
      // fiscalNumber/isCustomer/isVendor/isVatRegistered) only ever shows the new value while
      // this page itself is mounted — GET .../partners called from anywhere else (Invoicing.tsx/
      // Bills.tsx) hits the mock inactive and passes through to the real, unedited backend record,
      // and a page reload loses the mocked override entirely, since the store is in-memory only.
      // PartnerRegisterForm.tsx now disables those 6 fields in edit mode specifically to close
      // that gap — only controlAccountId/paymentTermDays/creditLimit (genuinely mocked, nothing
      // real to diverge from) are editable here; the 6 real values submitted below are always the
      // form's own unchanged `initial` values, never something the user could have edited.
      updatePartnerV2(activeCompanyId as string, vars.id, {
        name: vars.fields.name,
        taxNumber: vars.fields.taxNumber,
        isCustomer: vars.fields.isCustomer,
        isVendor: vars.fields.isVendor,
        fiscalNumber: vars.fields.fiscalNumber,
        isVatRegistered: vars.fields.isVatRegistered,
        controlAccountId: vars.fields.controlAccountId,
        paymentTermDays: vars.fields.paymentTermDays,
        creditLimit: vars.fields.creditLimit,
      }),
    onSuccess: async () => {
      setMutationError(null);
      setEditingId(null);
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "partners.saveError" }))),
  });

  const columns = useMemo<ColumnDef<PartnerV2>[]>(
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
        cell: ({ getValue }) => (getValue() as string | undefined) || "—",
      },
      {
        accessorKey: "fiscalNumber",
        header: intl.formatMessage({ id: "partners.form.fiscalNumber" }),
        cell: ({ getValue }) => (getValue() as string | undefined) || "—",
      },
      {
        id: "controlAccount",
        header: intl.formatMessage({ id: "partners.form.controlAccount" }),
        enableSorting: false,
        accessorFn: (row) => accountLabel(row.controlAccountId),
      },
      {
        accessorKey: "paymentTermDays",
        header: intl.formatMessage({ id: "partners.form.paymentTermDays" }),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const value = getValue();
          return typeof value === "number" ? value : "—";
        },
      },
      {
        accessorKey: "creditLimit",
        header: intl.formatMessage({ id: "partners.form.creditLimit" }),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const value = getValue();
          return typeof value === "number" ? `${value.toFixed(2)} €` : "—";
        },
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
            setFormOpen((open) => !open);
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
