import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/context/CompanyContext";
import { useIsCompanyAdmin } from "@/hooks/useIsCompanyAdmin";
import { AuditDetailDialog } from "@/pages/audit/AuditDetailDialog";
import { auditActionLabel, formatAuditDateTime } from "@/pages/audit/auditFormat";

const HISTORY_PAGE_SIZE = 20;

interface EntityHistoryProps {
  entityType: string;
  entityId: string;
  defaultOpen?: boolean;
}

export function EntityHistory({ entityType, entityId, defaultOpen = false }: EntityHistoryProps) {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const { isAdmin } = useIsCompanyAdmin(activeCompanyId);
  const [open, setOpen] = useState(defaultOpen);
  const [detailId, setDetailId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["audit", activeCompanyId, "history", entityType, entityId],
    queryFn: () =>
      apiClient.auditPaged(activeCompanyId as string, 1, HISTORY_PAGE_SIZE, entityType, entityId, undefined, undefined, undefined, undefined, undefined),
    enabled: !!activeCompanyId && isAdmin && open,
  });

  if (!activeCompanyId || !isAdmin) return null;

  const panelId = `entity-history-${entityType}-${entityId}`;
  const items = query.data?.items ?? [];

  return (
    <section className="rounded-md border" aria-label={intl.formatMessage({ id: "audit.history.title" })}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {intl.formatMessage({ id: "audit.history.title" })}
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-2 border-t px-3 py-2">
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "audit.history.description" })}</p>
          {query.isPending && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>}
          {query.isError && (
            <Alert variant="destructive">
              <AlertDescription>{getApiErrorMessage(query.error, intl.formatMessage({ id: "audit.history.loadError" }))}</AlertDescription>
            </Alert>
          )}
          {query.data && items.length === 0 && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "audit.history.empty" })}</p>}
          {items.length > 0 && (
            <ul className="flex flex-col divide-y">
              {items.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">{formatAuditDateTime(entry.occurredAtUtc)}</span>
                  <Badge variant="outline">{auditActionLabel(intl, entry.action)}</Badge>
                  <span className="min-w-0 flex-1 truncate">{entry.userName ?? entry.userEmail ?? intl.formatMessage({ id: "audit.system" })}</span>
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => setDetailId(entry.id)}
                  >
                    {intl.formatMessage({ id: "audit.viewDetails" })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.data && query.data.total > items.length && (
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({ id: "audit.history.more" }, { count: items.length })}{" "}
              <Link className="text-primary underline-offset-2 hover:underline" to="/audit-trail">
                {intl.formatMessage({ id: "audit.history.seeAll" })}
              </Link>
            </p>
          )}
        </div>
      )}
      <AuditDetailDialog companyId={activeCompanyId} entryId={detailId} onClose={() => setDetailId(null)} hideRecordLink />
    </section>
  );
}
