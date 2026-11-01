import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { List, TreePine } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { AccountResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { useCompany } from "@/context/CompanyContext";
import {
  CitDeductibility,
  accountGroupLabel,
  accountGroupsById,
  cashFlowCategoryLabel,
  citDeductibilityLabel,
  companyProfileLabels,
  leafAccountGroups,
  normalBalanceLabel,
  subledgerTypeLabel,
} from "@/lib/account-v2";
import { accountTypeLabel } from "@/lib/ledger-enums";
import { AccountForm, type AccountFormFields } from "@/pages/ledger/AccountForm";
import { ChartOfAccountsTree } from "@/pages/ledger/ChartOfAccountsTree";

const GRID_ID = "chartOfAccounts";

interface AccountRow extends AccountResponse {
  groupLabelText: string;
}

export function ChartOfAccounts() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode = searchParams.get("view") === "tree" ? "tree" : "list";
  const setViewMode = useCallback(
    (mode: "tree" | "list") => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (mode === "tree") next.set("view", "tree");
        else next.delete("view");
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useOpenParam();
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Default the grid's grouping to the group column the first time this screen is opened — F2
  // asks for a tree grouped by the account groups by default, not an opt-in the accountant has to
  // discover via the grid's own "Group by" control.
  const gridUrlState = useDataGridUrlState(GRID_ID);
  useEffect(() => {
    if (!gridUrlState.groupBy) gridUrlState.setGroupBy("groupLabelText");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountsQueryKey = ["chartOfAccounts", activeCompanyId] as const;
  const accountGroupsQueryKey = ["accountGroups", activeCompanyId] as const;

  const accountsQuery = useQuery({
    queryKey: accountsQueryKey,
    queryFn: () => apiClient.accountsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const accountGroupsQuery = useQuery({
    queryKey: accountGroupsQueryKey,
    queryFn: () => apiClient.accountGroups(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const groups = useMemo(() => accountGroupsQuery.data ?? [], [accountGroupsQuery.data]);
  const groupsById = useMemo(() => accountGroupsById(groups), [groups]);
  const groupOptions = useMemo(() => leafAccountGroups(groups), [groups]);
  const treeGroupLabel = useCallback(
    (g: Parameters<typeof accountGroupLabel>[0]) => accountGroupLabel(g, groupsById, intl),
    [groupsById, intl],
  );

  const rows = useMemo<AccountRow[]>(
    () => accounts.map((a) => ({ ...a, groupLabelText: accountGroupLabel(groupsById.get(a.groupId ?? ""), groupsById, intl) })),
    [accounts, groupsById, intl],
  );

  const editingAccount = editingId ? accounts.find((a) => a.id === editingId) ?? null : null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: accountsQueryKey });
  }

  const createMutation = useMutation({
    mutationFn: (fields: AccountFormFields) =>
      apiClient.accountsPOST(activeCompanyId as string, {
        ...fields,
        parentAccountId: undefined,
        validFrom: undefined,
        validTo: undefined,
      }),
    onSuccess: async () => {
      setMutationError(null);
      setDirty(false);
      setFormOpen(false);
      toast.success(intl.formatMessage({ id: "toast.accountCreated" }));
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "chartOfAccounts.createError" }))),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; fields: AccountFormFields }) =>
      apiClient.accountsPUT(activeCompanyId as string, vars.id, {
        ...vars.fields,
        parentAccountId: undefined,
        validFrom: undefined,
        validTo: undefined,
      }),
    onSuccess: async () => {
      setMutationError(null);
      setDirty(false);
      setEditingId(null);
      toast.success(intl.formatMessage({ id: "toast.accountSaved" }));
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "chartOfAccounts.saveError" }))),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.deactivate(activeCompanyId as string, id),
    onSuccess: async () => {
      setConfirmingDeactivateId(null);
      toast.success(intl.formatMessage({ id: "toast.accountDeactivated" }));
      await refresh();
    },
    onError: (err: unknown) => setMutationError(getApiErrorMessage(err, intl.formatMessage({ id: "chartOfAccounts.deactivateError" }))),
  });

  const columns = useMemo<ColumnDef<AccountRow>[]>(
    () => [
      {
        accessorKey: "code",
        header: intl.formatMessage({ id: "common.code" }),
        enableGrouping: false,
        cell: ({ getValue }) => <span className="font-mono">{String(getValue())}</span>,
      },
      {
        accessorKey: "name",
        header: intl.formatMessage({ id: "chartOfAccounts.form.name" }),
        enableGrouping: false,
        cell: ({ row }) => (
          <div className={row.original.isActive ? undefined : "text-muted-foreground line-through"}>
            <div>{row.original.name}</div>
            {row.original.nameSq && <div className="text-xs text-muted-foreground">{row.original.nameSq}</div>}
          </div>
        ),
      },
      {
        accessorKey: "groupLabelText",
        header: intl.formatMessage({ id: "chartOfAccounts.group" }),
        meta: { headerLabel: intl.formatMessage({ id: "chartOfAccounts.group" }) },
      },
      {
        id: "accountType",
        accessorFn: (row) => accountTypeLabel(row.accountType, intl),
        header: intl.formatMessage({ id: "common.type" }),
        meta: { headerLabel: intl.formatMessage({ id: "common.type" }) },
      },
      {
        id: "normalBalance",
        accessorFn: (row) => normalBalanceLabel(row.normalBalance, intl),
        header: intl.formatMessage({ id: "chartOfAccounts.form.normalBalance" }),
        enableGrouping: false,
      },
      {
        id: "subledger",
        accessorFn: (row) => subledgerTypeLabel(row.subledger, intl),
        header: intl.formatMessage({ id: "chartOfAccounts.subledger" }),
        enableGrouping: false,
      },
      {
        accessorKey: "defaultVatCode",
        header: intl.formatMessage({ id: "chartOfAccounts.vatCode" }),
        enableGrouping: false,
        cell: ({ getValue }) => {
          const value = getValue();
          return typeof value === "string" ? <span className="font-mono text-xs">{value}</span> : "—";
        },
      },
      {
        id: "cit",
        header: intl.formatMessage({ id: "chartOfAccounts.citTreatment" }),
        enableGrouping: false,
        enableSorting: false,
        cell: ({ row }) => {
          const account = row.original;
          const label = citDeductibilityLabel(account.citDeductibility, intl);
          if (account.citDeductibility === CitDeductibility.Limit) {
            return (
              <span title={account.citLimitRule ?? intl.formatMessage({ id: "chartOfAccounts.citLimitRuleUnset" })}>
                <Badge variant="outline">{label}</Badge>
              </span>
            );
          }
          return account.citDeductibility === CitDeductibility.Non ? (
            <Badge variant="destructive">{label}</Badge>
          ) : (
            <span className="text-muted-foreground">{label}</span>
          );
        },
      },
      {
        id: "cashFlowCategory",
        accessorFn: (row) => cashFlowCategoryLabel(row.cashFlowCategory, intl),
        header: intl.formatMessage({ id: "chartOfAccounts.cashFlowCategory" }),
        enableGrouping: false,
        meta: { headerLabel: intl.formatMessage({ id: "chartOfAccounts.cashFlowCategory" }) },
      },
      {
        id: "flags",
        header: intl.formatMessage({ id: "chartOfAccounts.flags" }),
        enableGrouping: false,
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => {
          const account = row.original;
          return (
            <div className="flex flex-wrap gap-1">
              {account.isControl && <Badge variant="secondary">{intl.formatMessage({ id: "chartOfAccounts.control" })}</Badge>}
              {!account.isPostable && <Badge variant="outline">{intl.formatMessage({ id: "chartOfAccounts.header" })}</Badge>}
              {!account.isActive && <Badge variant="destructive">{intl.formatMessage({ id: "common.inactive" })}</Badge>}
            </div>
          );
        },
      },
      {
        id: "profiles",
        header: intl.formatMessage({ id: "chartOfAccounts.form.profiles" }),
        enableGrouping: false,
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{companyProfileLabels(row.original.profiles, intl).join(" · ")}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableGrouping: false,
        enableSorting: false,
        enableColumnFilter: false,
        enableHiding: false,
        cell: ({ row }) => {
          const account = row.original;
          if (confirmingDeactivateId === account.id) {
            return (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "chartOfAccounts.confirmDeactivate" })}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-xs"
                  disabled={deactivateMutation.isPending}
                  onClick={() => deactivateMutation.mutate(account.id)}
                >
                  {intl.formatMessage({ id: "common.confirm" })}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setConfirmingDeactivateId(null)}>
                  {intl.formatMessage({ id: "common.cancel" })}
                </Button>
              </div>
            );
          }
          return (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => {
                  setEditingId(account.id);
                  setFormOpen(false);
                  setMutationError(null);
                  setDirty(false);
                }}
              >
                {intl.formatMessage({ id: "common.edit" })}
              </Button>
              {account.isActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs text-destructive"
                  onClick={() => setConfirmingDeactivateId(account.id)}
                >
                  {intl.formatMessage({ id: "chartOfAccounts.deactivate" })}
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [intl, confirmingDeactivateId, deactivateMutation, setEditingId],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = accountsQuery.isError || accountGroupsQuery.isError
    ? intl.formatMessage({ id: "chartOfAccounts.loadError" })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "chartOfAccounts.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "chartOfAccounts.description" })}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border">
            <Button
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              className="h-8 gap-1.5 rounded-r-none"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
              {intl.formatMessage({ id: "chartOfAccounts.listView" })}
            </Button>
            <Button
              size="sm"
              variant={viewMode === "tree" ? "secondary" : "ghost"}
              className="h-8 gap-1.5 rounded-l-none border-l"
              onClick={() => setViewMode("tree")}
            >
              <TreePine className="h-4 w-4" />
              {intl.formatMessage({ id: "chartOfAccounts.treeView" })}
            </Button>
          </div>
          <Button
            onClick={() => {
              setFormOpen(true);
              setEditingId(null);
              setMutationError(null);
              setDirty(false);
            }}
          >
            {intl.formatMessage({ id: "chartOfAccounts.addAccount" })}
          </Button>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <FormDialog
        open={formOpen}
        onOpenChange={(open) => { if (!open) { setFormOpen(false); setMutationError(null); setDirty(false); } }}
        title={intl.formatMessage({ id: "chartOfAccounts.addAccount" })}
        description={intl.formatMessage({ id: "chartOfAccounts.form.addDescription" })}
        size="lg"
        dirty={dirty}
      >
        <AccountForm
          mode="create"
          groupOptions={groupOptions}
          groupsById={groupsById}
          submitting={createMutation.isPending}
          error={mutationError}
          onSubmit={(fields) => createMutation.mutate(fields)}
          onCancel={() => { setFormOpen(false); setMutationError(null); setDirty(false); }}
          onDirtyChange={setDirty}
        />
      </FormDialog>

      <FormDialog
        open={editingAccount !== null}
        onOpenChange={(open) => { if (!open) { setEditingId(null); setMutationError(null); setDirty(false); } }}
        title={editingAccount ? intl.formatMessage({ id: "chartOfAccounts.editAccount" }, { code: editingAccount.code }) : ""}
        description={intl.formatMessage({ id: "chartOfAccounts.form.editDescription" })}
        size="lg"
        dirty={dirty}
      >
        {editingAccount && (
          <AccountForm
            mode="edit"
            groupOptions={groupOptions}
            groupsById={groupsById}
            initial={editingAccount}
            submitting={updateMutation.isPending}
            error={mutationError}
            onSubmit={(fields) => updateMutation.mutate({ id: editingAccount.id, fields })}
            onCancel={() => { setEditingId(null); setMutationError(null); setDirty(false); }}
            onDirtyChange={setDirty}
          />
        )}
      </FormDialog>

      {viewMode === "tree" ? (
        <ChartOfAccountsTree
          accounts={accounts}
          groupsById={groupsById}
          groupLabel={treeGroupLabel}
          onEdit={(id) => {
            setEditingId(id);
            setFormOpen(false);
            setMutationError(null);
            setDirty(false);
          }}
        />
      ) : (
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={accountsQuery.isPending || accountGroupsQuery.isPending}
          getRowId={(row) => row.id}
          enableGlobalFilter
          globalFilterPlaceholder={intl.formatMessage({ id: "chartOfAccounts.searchPlaceholder" })}
          emptyMessage={intl.formatMessage({ id: "chartOfAccounts.noAccounts" })}
          exportFileName="chart-of-accounts"
          getRowClassName={(row) => (row.isActive ? undefined : "text-muted-foreground/70")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
          defaultPageSize={500}
          pageSizeOptions={[500]}
        />
      )}
    </div>
  );
}
