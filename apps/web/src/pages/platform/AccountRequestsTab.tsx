import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { AccountRequestResponse } from "@pako/shared";
import { Copy } from "lucide-react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useUrlParam } from "@/pages/platform/useUrlParam";

const GRID_ID = "platform-requests";

// Mirrors AccountRequestStatus (numeric in the query, a string in responses).
const statuses = [
  { key: "pending", value: 0 },
  { key: "approved", value: 1 },
  { key: "rejected", value: 2 },
  { key: "all", value: undefined },
] as const;

// People asking for a PAKO account. Approving creates the login with a company limit and emails a
// link to set the password (also shown here to copy); rejecting records why.
export function AccountRequestsTab() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  // Changing the status starts again from page 1 (the grid's page parameter is cleared with it).
  const [statusKey, setStatusKey] = useUrlParam("status", "pending", [`${GRID_ID}.page`]);
  const status = statuses.find((s) => s.key === statusKey) ?? statuses[0];
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [open, setOpen] = useState<AccountRequestResponse | null>(null);
  const query = useQuery({
    queryKey: ["platform", "requests", status.key, grid.page, grid.pageSize, grid.globalFilter],
    queryFn: () => apiClient.listAccountRequests(status.value, grid.globalFilter || undefined, grid.page, grid.pageSize),
    placeholderData: keepPreviousData,
  });
  const date = (v: string | undefined) => (v ? intl.formatDate(new Date(v), { dateStyle: "medium", timeStyle: "short" }) : "—");

  const columns = useMemo<ColumnDef<AccountRequestResponse>[]>(
    () => [
      { accessorKey: "createdAt", header: t("platform.col.received"), cell: ({ getValue }) => date(getValue() as string) },
      {
        accessorKey: "fullName",
        header: t("platform.col.person"),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium">{row.original.fullName}</span>
            <span className="text-xs text-muted-foreground">{row.original.email}</span>
          </span>
        ),
      },
      { accessorKey: "firmName", header: t("requestAccount.firmName"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "city", header: t("requestAccount.city"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "phone", header: t("requestAccount.phone"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "requestedCompanies", header: t("platform.col.requested"), meta: { numeric: true } },
      { accessorKey: "status", header: t("platform.col.status"), cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex w-fit rounded-md border bg-card p-0.5" role="radiogroup" aria-label={t("platform.col.status")}>
        {statuses.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={status.key === s.key}
            onClick={() => setStatusKey(s.key)}
            className={cn(
              "h-7 rounded-[5px] px-3 text-[12.5px] font-medium",
              status.key === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {t(`platform.requests.${s.key}`)}
          </button>
        ))}
      </div>
      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={query.data?.items ?? []}
        rowCount={query.data?.total ?? 0}
        enableGlobalFilter
        globalFilterPlaceholder={t("platform.requests.search")}
        isLoading={query.isPending}
        getRowId={(r) => r.id}
        onRowClick={setOpen}
        emptyMessage={t(status.key === "pending" ? "platform.requests.nonePending" : "platform.requests.none")}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
      />
      {open && <RequestDialog request={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const intl = useIntl();
  const label = intl.formatMessage({ id: `platform.requests.${status.toLowerCase()}` });
  return status === "Pending" ? <Badge variant="warning">{label}</Badge> : status === "Approved" ? <Badge variant="success">{label}</Badge> : <Badge variant="secondary">{label}</Badge>;
}

function RequestDialog({ request, onClose }: { request: AccountRequestResponse; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(String(request.requestedCompanies));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const pending = request.status === "Pending";

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform"] });
  const approve = useMutation({
    mutationFn: () => apiClient.approveAccountRequest(request.id, { companyLimit: Math.max(0, Math.floor(Number(limit) || 0)), note: note.trim() || undefined }),
    onSuccess: async (result) => {
      setLink(result.setPasswordUrl);
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("platform.requests.decideError"))),
  });
  const reject = useMutation({
    mutationFn: () => apiClient.rejectAccountRequest(request.id, { note: note.trim() || undefined }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("platform.requests.decideError"))),
  });

  const detail = (labelId: string, value: string | number | undefined | null) => (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{t(labelId)}</dt>
      <dd className="text-sm">{value === undefined || value === null || value === "" ? "—" : value}</dd>
    </div>
  );

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={request.fullName} description={request.email} size="md" dirty={link !== null}>
      <div className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {detail("requestAccount.phone", request.phone)}
          {detail("requestAccount.city", request.city)}
          {detail("requestAccount.firmName", request.firmName)}
          {detail("requestAccount.businessNumber", request.businessNumber)}
          {detail("platform.col.requested", request.requestedCompanies)}
          {detail("platform.col.received", intl.formatDate(new Date(request.createdAt), { dateStyle: "medium", timeStyle: "short" }))}
        </dl>
        {request.message && (
          <div>
            <p className="text-xs text-muted-foreground">{t("requestAccount.message")}</p>
            <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{request.message}</p>
          </div>
        )}

        {link ? (
          <div className="flex flex-col gap-2 rounded-md border border-success-border bg-success p-3 text-success-foreground">
            <p className="text-sm font-medium">{t("platform.requests.approvedTitle")}</p>
            <p className="text-xs">{t("platform.requests.approvedBody", { email: request.email })}</p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="bg-background text-foreground" aria-label={t("platform.requests.link")} />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(link).then(
                    () => toast.success(t("platform.requests.copied")),
                    () => toast.error(t("platform.requests.copyFailed")),
                  );
                }}
              >
                <Copy className="size-4" />
                {t("platform.requests.copy")}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={onClose}>
                {t("platform.done")}
              </Button>
            </div>
          </div>
        ) : pending ? (
          <div className="flex flex-col gap-4 border-t pt-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-limit">{t("platform.requests.limit")}</Label>
              <Input id="ar-limit" type="number" min={0} className="w-28" value={limit} onChange={(e) => setLimit(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("platform.requests.limitHint")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-note">{t("platform.requests.note")}</Label>
              <Textarea id="ar-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("platform.requests.noteHint")} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={approve.isPending || reject.isPending} onClick={() => reject.mutate()}>
                {t("platform.requests.reject")}
              </Button>
              <Button type="button" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate()}>
                {t("platform.requests.approve")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 border-t pt-4 text-sm">
            <span>
              <StatusBadge status={request.status} />{" "}
              {request.decidedAt && t("platform.requests.decidedBy", { who: request.decidedBy ?? "—", when: intl.formatDate(new Date(request.decidedAt), { dateStyle: "medium" }) })}
            </span>
            {request.decisionNote && <span className="text-muted-foreground">{request.decisionNote}</span>}
          </div>
        )}
      </div>
    </FormDialog>
  );
}
