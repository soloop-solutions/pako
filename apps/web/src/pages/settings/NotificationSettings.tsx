import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { NotificationLogResponse, NotificationSettingResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useMyAccess } from "@/hooks/useMyAccess";

interface NotificationSettingsProps {
  companyId: string;
}

// The log shows the most recent 200 emails; older ones stay in the database.
const LOG_LIMIT = 200;

const stateVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Sent: "secondary",
  Pending: "outline",
  Failed: "destructive",
  Skipped: "outline",
};

// E7: which emails this company sends (all on by default), and a log of what was sent.
export function NotificationSettings({ companyId }: NotificationSettingsProps) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { access } = useMyAccess();
  const isAdmin = access?.isAdmin ?? false;
  const [error, setError] = useState<string | null>(null);

  const settingsKey = ["notificationSettings", companyId] as const;
  const logKey = ["notificationLog", companyId] as const;

  const settingsQuery = useQuery({ queryKey: settingsKey, queryFn: () => apiClient.getNotificationSettings(companyId) });
  const logQuery = useQuery({
    queryKey: logKey,
    queryFn: () => apiClient.listNotificationLog(companyId, 1, LOG_LIMIT, undefined),
    enabled: isAdmin,
  });

  const saveMutation = useMutation({
    mutationFn: (settings: NotificationSettingResponse[]) => apiClient.saveNotificationSettings(companyId, { settings }),
    onSuccess: (saved) => {
      setError(null);
      queryClient.setQueryData(settingsKey, saved);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "notifications.saveError" }))),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiClient.retryNotification(companyId, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: logKey }),
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "notifications.retryError" }))),
  });

  const templateLabel = (template: string) => intl.formatMessage({ id: `notifications.template.${template}` });

  const columns = useMemo<ColumnDef<NotificationLogResponse>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: intl.formatMessage({ id: "notifications.log.createdAt" }),
        cell: ({ getValue }) => intl.formatDate(getValue() as string, { dateStyle: "short", timeStyle: "short" }),
      },
      {
        accessorKey: "template",
        header: intl.formatMessage({ id: "notifications.log.template" }),
        cell: ({ getValue }) => templateLabel(getValue() as string),
      },
      { accessorKey: "recipientEmail", header: intl.formatMessage({ id: "notifications.log.recipient" }) },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "notifications.log.state" }),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <Badge variant={stateVariant[row.original.state] ?? "outline"}>
              {intl.formatMessage({ id: `notifications.state.${row.original.state}` })}
            </Badge>
            {row.original.lastError && (
              <span className="truncate text-xs text-muted-foreground" title={row.original.lastError}>
                {row.original.lastError}
              </span>
            )}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.state === "Failed" ? (
            <Button size="xs" variant="ghost" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate(row.original.id)}>
              {intl.formatMessage({ id: "notifications.retry" })}
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, retryMutation.isPending],
  );

  const settings = settingsQuery.data ?? [];

  function toggle(template: string, enabled: boolean) {
    saveMutation.mutate(settings.map((s) => (s.template === template ? { ...s, enabled } : s)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "notifications.title" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "notifications.description" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <fieldset className="grid gap-2 sm:grid-cols-2" disabled={!isAdmin || saveMutation.isPending}>
          {settings.map((s) => (
            <label key={s.template} className="flex items-center gap-2 text-sm">
              <Checkbox checked={s.enabled} onChange={(e) => toggle(s.template, e.target.checked)} />
              {templateLabel(s.template)}
            </label>
          ))}
        </fieldset>
        {!isAdmin && <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "notifications.adminOnly" })}</p>}

        {isAdmin && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{intl.formatMessage({ id: "notifications.log.title" })}</p>
            <DataGrid
              gridId="notification-log"
              columns={columns}
              data={logQuery.data?.items ?? []}
              rowCount={logQuery.data?.items.length ?? 0}
              isLoading={logQuery.isPending}
              getRowId={(row) => row.id}
              manualFiltering={false}
              manualSorting={false}
              manualGrouping={false}
              emptyMessage={intl.formatMessage({ id: "notifications.log.empty" })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
