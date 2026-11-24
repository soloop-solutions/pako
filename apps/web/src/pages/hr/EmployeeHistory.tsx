import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useIntl } from "react-intl";
import type { AuditEntryResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("sq-XK")} ${d.toLocaleTimeString("sq-XK", { hour: "2-digit", minute: "2-digit" })}`;
}

function parseChanges(json: string | null | undefined): { field: string; oldValue: string | null; newValue: string | null }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c: { Field?: string; OldValue?: string; NewValue?: string }) => ({
      field: c.Field ?? "?",
      oldValue: c.OldValue ?? null,
      newValue: c.NewValue ?? null,
    }));
  } catch {
    return [];
  }
}

export function EmployeeHistory({ companyId, employeeId }: { companyId: string; employeeId: string }) {
  const intl = useIntl();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["employeeHistory", companyId, employeeId, page],
    queryFn: () => apiClient.employeeHistory(companyId, employeeId, page, PAGE_SIZE),
    enabled: !!companyId && !!employeeId,
  });

  const items: AuditEntryResponse[] = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{getApiErrorMessage(query.error, intl.formatMessage({ id: "hr.employee.history.loadError" }))}</AlertDescription>
      </Alert>
    );
  }

  if (!query.isPending && items.length === 0) {
    return <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "hr.employee.history.empty" })}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((entry) => {
        const changes = parseChanges(entry.changes);
        const user = entry.userName ?? entry.userEmail ?? "";
        const actionLabel = entry.action === "Created"
          ? intl.formatMessage({ id: "hr.employee.history.created" })
          : intl.formatMessage({ id: "hr.employee.history.updated" });

        return (
          <div key={entry.id} className="rounded-md border px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{user}</span> — {actionLabel}
              </span>
              <span className="tabular-nums">{formatDateTime(entry.occurredAtUtc)}</span>
            </div>
            {changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {changes.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">{c.field}</span>:{" "}
                    {c.oldValue && <span className="text-muted-foreground line-through">{c.oldValue}</span>}
                    {c.oldValue && c.newValue && " → "}
                    {c.newValue && <span>{c.newValue}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {hasMore && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-center"
          disabled={query.isPending}
          onClick={() => setPage((p) => p + 1)}
        >
          {intl.formatMessage({ id: "hr.employee.history.loadMore" })}
        </Button>
      )}
    </div>
  );
}
