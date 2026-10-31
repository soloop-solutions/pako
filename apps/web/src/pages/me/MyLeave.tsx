import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { LeaveBalanceResponse, LeaveRequestResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { cn } from "@/lib/utils";
import { currentYear, formatDate } from "@/pages/leave/leaveShared";

const stateVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Pending: "outline",
  Approved: "secondary",
  Rejected: "destructive",
  Cancelled: "outline",
};

function days(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// F9: my leave balances, a request form and my requests; managers also get their team's
// pending requests to approve. Balances are rendered exactly as the API computes them.
export function MyLeave() {
  const intl = useIntl();
  const { activeCompanyId: companyId } = useCompany();
  const { access } = useMyAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "team" && access?.isTeamManager ? "team" : "mine";
  const year = currentYear();
  const queryClient = useQueryClient();

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const typesQuery = useQuery({
    queryKey: ["me", "leaveTypes", companyId],
    queryFn: () => apiClient.listMyLeaveTypes(companyId as string),
    enabled: !!companyId,
  });
  const balancesQuery = useQuery({
    queryKey: ["me", "leaveBalances", companyId, year],
    queryFn: () => apiClient.listMyLeaveBalances(companyId as string, year),
    enabled: !!companyId,
  });
  const requestsQuery = useQuery({
    queryKey: ["me", "leaveRequests", companyId],
    queryFn: () => apiClient.listMyLeaveRequests(companyId as string),
    enabled: !!companyId,
  });
  const teamQuery = useQuery({
    queryKey: ["me", "teamLeave", companyId],
    queryFn: () => apiClient.listMyTeamLeaveRequests(companyId as string, "Pending"),
    enabled: !!companyId && !!access?.isTeamManager,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["me"] });

  const createMutation = useMutation({
    mutationFn: () => apiClient.createMyLeaveRequest(companyId as string, { leaveTypeId, startDate, endDate, reason: reason.trim() || undefined }),
    onSuccess: (created) => {
      setError(null);
      setNotice(intl.formatMessage({ id: "me.leave.submitted" }, { days: days(created.days) }));
      setStartDate("");
      setEndDate("");
      setReason("");
      refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "leave.requests.createError" }))),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.cancelMyLeaveRequest(companyId as string, id),
    onSuccess: refresh,
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "leave.requests.cancelError" }))),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? apiClient.approveTeamLeaveRequest(companyId as string, id) : apiClient.rejectTeamLeaveRequest(companyId as string, id),
    onSuccess: refresh,
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "leave.requests.approveError" }))),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    if (!leaveTypeId || !startDate || !endDate) {
      setError(intl.formatMessage({ id: "me.leave.missingFields" }));
      return;
    }
    if (endDate < startDate) {
      setError(intl.formatMessage({ id: "leave.requests.endBeforeStart" }));
      return;
    }
    createMutation.mutate();
  }

  const stateCell = (state: string) => (
    <Badge variant={stateVariant[state] ?? "outline"} className={cn(state === "Cancelled" && "line-through")}>
      {intl.formatMessage({ id: `leave.state.${state}` })}
    </Badge>
  );

  const myColumns = useMemo<ColumnDef<LeaveRequestResponse>[]>(
    () => [
      { accessorKey: "leaveTypeName", header: intl.formatMessage({ id: "me.leave.type" }) },
      { accessorKey: "startDate", header: intl.formatMessage({ id: "me.leave.from" }), cell: ({ getValue }) => formatDate(getValue() as string) },
      { accessorKey: "endDate", header: intl.formatMessage({ id: "me.leave.to" }), cell: ({ getValue }) => formatDate(getValue() as string) },
      { accessorKey: "days", header: intl.formatMessage({ id: "me.leave.days" }), meta: { numeric: true }, cell: ({ getValue }) => days(getValue() as number) },
      { accessorKey: "state", header: intl.formatMessage({ id: "me.leave.status" }), cell: ({ getValue }) => stateCell(getValue() as string) },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.state === "Pending" ? (
            <Button size="xs" variant="ghost" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(row.original.id)}>
              {intl.formatMessage({ id: "me.leave.cancel" })}
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, cancelMutation.isPending],
  );

  const teamColumns = useMemo<ColumnDef<LeaveRequestResponse>[]>(
    () => [
      { accessorKey: "employeeName", header: intl.formatMessage({ id: "me.leave.employee" }) },
      ...myColumns.slice(0, 4),
      { accessorKey: "reason", header: intl.formatMessage({ id: "me.leave.reason" }), cell: ({ getValue }) => (getValue() as string) || "—" },
      {
        id: "decide",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="xs" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ id: row.original.id, approve: true })}>
              {intl.formatMessage({ id: "me.leave.approve" })}
            </Button>
            <Button size="xs" variant="outline" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ id: row.original.id, approve: false })}>
              {intl.formatMessage({ id: "me.leave.reject" })}
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, myColumns, decideMutation.isPending],
  );

  if (!companyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const balances = balancesQuery.data ?? [];
  const requests = requestsQuery.data ?? [];
  const team = teamQuery.data ?? [];
  const loadError = [typesQuery, balancesQuery, requestsQuery].find((q) => q.isError)?.error;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "me.leave.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "me.leave.description" }, { year })}</p>
        </div>
        {access?.isTeamManager && (
          <div role="tablist" className="flex gap-1 rounded-md border p-0.5">
            {(["mine", "team"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setSearchParams(id === "team" ? { tab: "team" } : {}, { replace: true })}
                className={cn("rounded px-3 py-1 text-[13px] font-medium", tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                {intl.formatMessage({ id: `me.leave.tab.${id}` }, { count: team.length })}
              </button>
            ))}
          </div>
        )}
      </div>

      {(error || loadError) && (
        <Alert variant="destructive">
          <AlertDescription>{error ?? getApiErrorMessage(loadError, intl.formatMessage({ id: "me.loadError" }))}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {tab === "team" ? (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "me.leave.teamTitle" })}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataGrid
              gridId="my-team-leave"
              columns={teamColumns}
              data={team}
              rowCount={team.length}
              isLoading={teamQuery.isPending}
              getRowId={(row) => row.id}
              emptyMessage={intl.formatMessage({ id: "me.leave.teamEmpty" })}
              manualFiltering={false}
              manualSorting={false}
              manualGrouping={false}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b: LeaveBalanceResponse) => (
              <Card key={b.leaveTypeId} className="gap-1 py-3">
                <CardContent className="flex flex-col gap-1 px-4">
                  <span className="text-sm text-muted-foreground">{b.leaveTypeName}</span>
                  <span className={cn("text-2xl font-semibold tabular-nums", b.remaining < 0 && "text-destructive")}>
                    {intl.formatMessage({ id: "me.leave.daysLeft" }, { days: days(b.remaining) })}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {intl.formatMessage(
                      { id: "me.leave.balanceLine" },
                      { allocated: days(b.allocated), taken: days(b.taken), pending: days(b.pending) },
                    )}
                  </span>
                  {(b.carriedOver ?? 0) > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {intl.formatMessage(
                        { id: (b.expiredCarryOver ?? 0) > 0 ? "me.leave.carriedExpired" : "me.leave.carried" },
                        { days: days(b.carriedOver ?? 0), expired: days(b.expiredCarryOver ?? 0), date: formatDate(b.carryOverExpiresOn) },
                      )}
                    </span>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{intl.formatMessage({ id: "leave.requests.new" })}</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="my-leave-type">{intl.formatMessage({ id: "me.leave.type" })}</Label>
                  <Select
                    id="my-leave-type"
                    value={leaveTypeId}
                    onValueChange={setLeaveTypeId}
                    placeholder={intl.formatMessage({ id: "me.leave.chooseType" })}
                    options={(typesQuery.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="my-leave-from">{intl.formatMessage({ id: "me.leave.from" })}</Label>
                  <Input id="my-leave-from" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="my-leave-to">{intl.formatMessage({ id: "me.leave.to" })}</Label>
                  <Input id="my-leave-to" type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="my-leave-reason">{intl.formatMessage({ id: "me.leave.reason" })}</Label>
                  <Input id="my-leave-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <Button type="submit" disabled={createMutation.isPending}>
                  {intl.formatMessage({ id: "leave.requests.submit" })}
                </Button>
              </form>
              <p className="mt-2 text-xs text-muted-foreground">{intl.formatMessage({ id: "me.leave.workingDaysHint" })}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{intl.formatMessage({ id: "me.leave.myRequests" })}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataGrid
                gridId="my-leave-requests"
                columns={myColumns}
                data={requests}
                rowCount={requests.length}
                isLoading={requestsQuery.isPending}
                getRowId={(row) => row.id}
                getRowClassName={(row) => (row.state === "Cancelled" || row.state === "Rejected" ? "text-muted-foreground" : undefined)}
                emptyMessage={intl.formatMessage({ id: "me.leave.empty" })}
                manualFiltering={false}
                manualSorting={false}
                manualGrouping={false}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
