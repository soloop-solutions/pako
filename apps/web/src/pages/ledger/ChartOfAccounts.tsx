import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { createAccountV2, deactivateAccountV2, updateAccountV2, type AccountV2WriteFields } from "@/api/accounts-v2-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { useCompany } from "@/context/CompanyContext";
import {
  CitDeductibility,
  citDeductibilityLabel,
  companyProfileLabels,
  groupLabel,
  normalBalanceLabel,
  subledgerTypeLabel,
  type AccountV2,
} from "@/lib/account-v2";
import { accountTypeLabel } from "@/lib/ledger-enums";
import { setAccountsMockActive } from "@/mocks/accountsMockFlag";
import { ensureAccountsMockWorkerStarted } from "@/mocks/mockInit";
import { AccountForm, type GroupOption } from "@/pages/ledger/AccountForm";

const GRID_ID = "chartOfAccounts";

interface AccountRow extends AccountV2 {
  groupLabelText: string;
}

export function ChartOfAccounts() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Mount-scoped mock — the F2 mock only answers real accounts requests while this screen is
  // actually on screen, not for the whole app session. See src/mocks/handlers.ts (the
  // setAccountsMockActive flag this toggles) and src/mocks/mockInit.ts for why this is a
  // synchronous flag rather than starting/stopping the worker itself around mount/unmount: a
  // stop/start race around a route transition (this screen unmounting while e.g. Ledger mounts
  // in the same commit) can't be closed by promise timing alone, only by a flag read fresh at
  // request-resolution time. The flag flip itself must stay perfectly synchronous with the
  // effect (no async work before it) for that guarantee to hold.
  const [mockReady, setMockReady] = useState(false);
  useEffect(() => {
    setAccountsMockActive(true);
    let cancelled = false;
    void ensureAccountsMockWorkerStarted().then(() => {
      if (!cancelled) setMockReady(true);
    });
    return () => {
      cancelled = true;
      setMockReady(false);
      setAccountsMockActive(false);
    };
  }, []);

  // Default the grid's grouping to the code-prefix group column the first time this screen is
  // opened — F2 asks for a tree grouped by the code-prefix groups by default, not an opt-in the
  // accountant has to discover via the grid's own "Group by" control.
  const gridUrlState = useDataGridUrlState(GRID_ID);
  useEffect(() => {
    if (!gridUrlState.groupBy) gridUrlState.setGroupBy("groupLabelText");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountsQueryKey = ["chartOfAccountsV2", activeCompanyId] as const;

  const accountsQuery = useQuery({
    queryKey: accountsQueryKey,
    queryFn: async () => {
      // GET .../accounts is the real generated client method — the F2 mock intercepts this exact
      // URL and returns the full v2 field set instead of the real (today: 7-field) response. See
      // src/mocks/handlers.ts.
      const result = await apiClient.accountsAll(activeCompanyId as string);
      return result as unknown as AccountV2[];
    },
    enabled: !!activeCompanyId && mockReady,
  });

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  const groupOptions = useMemo<GroupOption[]>(() => {
    const seen = new Map<string, GroupOption>();
    for (const a of accounts) {
      if (a.class == null || a.group == null) continue;
      const key = `${a.class}.${a.group}`;
      if (!seen.has(key)) seen.set(key, { accountClass: a.class, group: a.group });
    }
    return Array.from(seen.values()).sort((a, b) => a.group - b.group);
  }, [accounts]);

  const rows = useMemo<AccountRow[]>(
    () => accounts.map((a) => ({ ...a, groupLabelText: groupLabel(a.class, a.group, intl) })),
    [accounts, intl],
  );

  const editingAccount = editingId ? accounts.find((a) => a.id === editingId) ?? null : null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: accountsQueryKey });
  }

  const createMutation = useMutation({
    mutationFn: (fields: AccountV2WriteFields & { code: string }) => createAccountV2(activeCompanyId as string, fields),
    onSuccess: async () => {
      setMutationError(null);
      setFormOpen(false);
      await refresh();
    },
    onError: (err: Error) => setMutationError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; fields: AccountV2WriteFields }) =>
      updateAccountV2(activeCompanyId as string, vars.id, vars.fields),
    onSuccess: async () => {
      setMutationError(null);
      setEditingId(null);
      await refresh();
    },
    onError: (err: Error) => setMutationError(err.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateAccountV2(activeCompanyId as string, id),
    onSuccess: async () => {
      setConfirmingDeactivateId(null);
      await refresh();
    },
    onError: (err: Error) => setMutationError(err.message),
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
    [intl, confirmingDeactivateId, deactivateMutation],
  );

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const loadError = accountsQuery.isError
    ? intl.formatMessage({ id: "chartOfAccounts.loadError" })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "chartOfAccounts.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "chartOfAccounts.description" })}</p>
        </div>
        <Button
          onClick={() => {
            setFormOpen((open) => !open);
            setEditingId(null);
            setMutationError(null);
          }}
        >
          {intl.formatMessage({ id: "chartOfAccounts.addAccount" })}
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
            <CardTitle>{intl.formatMessage({ id: "chartOfAccounts.addAccount" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "chartOfAccounts.form.addDescription" })}</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountForm
              mode="create"
              groupOptions={groupOptions}
              submitting={createMutation.isPending}
              error={mutationError}
              onSubmit={(fields) => createMutation.mutate(fields as AccountV2WriteFields & { code: string })}
              onCancel={() => {
                setFormOpen(false);
                setMutationError(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      {editingAccount && (
        <Card>
          <CardHeader>
            <CardTitle>
              {intl.formatMessage({ id: "chartOfAccounts.editAccount" }, { code: editingAccount.code })}
            </CardTitle>
            <CardDescription>{intl.formatMessage({ id: "chartOfAccounts.form.editDescription" })}</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountForm
              mode="edit"
              groupOptions={groupOptions}
              initial={editingAccount}
              submitting={updateMutation.isPending}
              error={mutationError}
              onSubmit={(fields) => updateMutation.mutate({ id: editingAccount.id, fields: fields as AccountV2WriteFields })}
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
        data={rows}
        rowCount={rows.length}
        isLoading={accountsQuery.isPending}
        getRowId={(row) => row.id}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "chartOfAccounts.searchPlaceholder" })}
        emptyMessage={intl.formatMessage({ id: "chartOfAccounts.noAccounts" })}
        exportFileName="chart-of-accounts"
        getRowClassName={(row) => (row.isActive ? undefined : "text-muted-foreground/70")}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        // DataGrid always expects `data` pre-sliced to the current page (its pagination itself is
        // always "manual" — see DataGrid.tsx). A tree view should never split a group across pages,
        // so this screen keeps the whole chart on one page instead: a single page-size option large
        // enough to hold a full v2 chart (233 real accounts) plus headroom for a company's own extra
        // accounts, rather than a real paging control that would fragment the tree.
        defaultPageSize={500}
        pageSizeOptions={[500]}
      />
    </div>
  );
}
