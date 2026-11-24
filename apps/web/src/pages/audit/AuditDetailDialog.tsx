import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { entityPath } from "@/lib/entityLinks";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  auditActionLabel,
  auditEntityPath,
  auditEntityTypeLabel,
  formatAuditDateTime,
  formatAuditValue,
  humanizeField,
} from "@/pages/audit/auditFormat";

interface AuditDetailDialogProps {
  companyId: string;
  entryId: string | null;
  onClose: () => void;
  hideRecordLink?: boolean;
}

export function AuditDetailDialog({ companyId, entryId, onClose, hideRecordLink = false }: AuditDetailDialogProps) {
  const intl = useIntl();
  const query = useQuery({
    queryKey: ["audit", companyId, "detail", entryId],
    queryFn: () => apiClient.auditDetail(companyId, entryId as string),
    enabled: !!entryId,
  });
  const detail = query.data;
  const entry = detail?.entry;
  const none = intl.formatMessage({ id: "audit.detail.none" });
  const recordPath = entry && !hideRecordLink ? auditEntityPath(entry.entityType, entry.entityId) : null;
  const sourcePath = entry ? entityPath({ kind: entry.sourceKind, id: entry.sourceDocumentId }) : null;

  return (
    <Dialog open={!!entryId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "audit.detail.title" })}</DialogTitle>
          <DialogDescription>
            {entry
              ? `${auditEntityTypeLabel(intl, entry.entityType)} · ${auditActionLabel(intl, entry.action)}`
              : intl.formatMessage({ id: "audit.description" })}
          </DialogDescription>
        </DialogHeader>

        {query.isPending && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>}
        {query.isError && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(query.error, intl.formatMessage({ id: "audit.detail.loadError" }))}</AlertDescription>
          </Alert>
        )}

        {detail && entry && (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Meta label={intl.formatMessage({ id: "audit.detail.when" })}>{formatAuditDateTime(entry.occurredAtUtc)}</Meta>
              <Meta label={intl.formatMessage({ id: "audit.detail.who" })}>
                {entry.userName || entry.userEmail
                  ? `${entry.userName ?? ""}${entry.userName && entry.userEmail ? " · " : ""}${entry.userEmail ?? ""}`
                  : intl.formatMessage({ id: "audit.system" })}
              </Meta>
              <Meta label={intl.formatMessage({ id: "audit.col.ip" })}>{entry.ipAddress ?? none}</Meta>
              <Meta label={intl.formatMessage({ id: "audit.col.sequence" })}>{entry.sequenceNumber ?? none}</Meta>
              <Meta label={intl.formatMessage({ id: "audit.detail.record" })}>
                {recordPath ? (
                  <Link className="text-primary underline-offset-2 hover:underline" to={recordPath}>
                    {intl.formatMessage({ id: "audit.openRecord" })}
                  </Link>
                ) : (
                  <span className="break-all font-mono text-xs">{entry.entityId}</span>
                )}
              </Meta>
              <Meta label={intl.formatMessage({ id: "audit.detail.requestId" })}>
                <span className="break-all font-mono text-xs">{entry.requestId ?? none}</span>
              </Meta>
              <Meta label={intl.formatMessage({ id: "audit.detail.sourceDocument" })}>
                {sourcePath ? (
                  <Link className="text-primary underline-offset-2 hover:underline" to={sourcePath}>
                    {intl.formatMessage({ id: "audit.detail.openSource" }, { kind: auditEntityTypeLabel(intl, entry.sourceKind ?? "") })}
                  </Link>
                ) : (
                  <span className="break-all font-mono text-xs">{entry.sourceDocumentId ?? none}</span>
                )}
              </Meta>
            </dl>

            <section aria-labelledby="audit-detail-changes" className="flex flex-col gap-2">
              <h3 id="audit-detail-changes" className="text-sm font-medium">{intl.formatMessage({ id: "audit.detail.changes" })}</h3>
              {detail.fields.length > 0 ? (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">{intl.formatMessage({ id: "audit.detail.field" })}</TableHead>
                        <TableHead scope="col">{intl.formatMessage({ id: "audit.detail.before" })}</TableHead>
                        <TableHead scope="col">{intl.formatMessage({ id: "audit.detail.after" })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.fields.map((field, index) => (
                        <TableRow key={`${field.field}-${index}`}>
                          <TableCell className="font-medium">{humanizeField(field.field)}</TableCell>
                          <TableCell className="whitespace-normal break-words text-muted-foreground">
                            {formatAuditValue(intl, field.field, field.oldValue)}
                          </TableCell>
                          <TableCell className="whitespace-normal break-words">
                            {formatAuditValue(intl, field.field, field.newValue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "audit.detail.noFields" })}</p>
                  {entry.changes && (
                    <p className="text-xs text-muted-foreground">
                      {intl.formatMessage({ id: "audit.detail.rawChanges" })}: <Badge variant="outline" className="break-all font-mono">{entry.changes}</Badge>
                    </p>
                  )}
                </>
              )}
            </section>

            <dl className="grid gap-2 text-sm">
              <Meta label={intl.formatMessage({ id: "audit.detail.entryHash" })}>
                <span className="break-all font-mono text-xs">{entry.entryHash ?? none}</span>
              </Meta>
              <Meta label={intl.formatMessage({ id: "audit.detail.prevHash" })}>
                <span className="break-all font-mono text-xs">{detail.prevHash ?? none}</span>
              </Meta>
            </dl>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
