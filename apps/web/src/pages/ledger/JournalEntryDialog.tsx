import { useQuery } from "@tanstack/react-query";
import { formatDisplayDate } from "@/lib/dates";
import { Link } from "react-router-dom";
import { useIntl } from "react-intl";
import type { AccountResponse, JournalEntryResponse, JournalResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { FormDialog } from "@/components/shared/FormDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { documentStateBadgeVariant } from "@/lib/document-types";
import { entityPath, partnerPath } from "@/lib/entityLinks";
import { formatAmount } from "@/lib/payroll-enums";

interface JournalEntryDialogProps {
  companyId: string;
  entry: JournalEntryResponse | null;
  accounts: AccountResponse[];
  journals: JournalResponse[];
  onClose: () => void;
}

export function JournalEntryDialog({ companyId, entry, accounts, journals, onClose }: JournalEntryDialogProps) {
  const intl = useIntl();
  const detailQuery = useQuery({
    queryKey: ["journalEntryDetail", companyId, entry?.id] as const,
    queryFn: () => apiClient.journalEntryDetail(companyId, entry!.id),
    enabled: !!entry,
  });
  const detail = detailQuery.data;
  const source = detail?.sourceDocument;
  const sourceLink = detail ? entityPath({ kind: detail.sourceKind, id: detail.sourceId }) : null;
  const partnerLink = source ? partnerPath(source.partnerId, source.kind === "Invoice" || source.kind === "SalesReturn" ? "customer" : "vendor") : null;
  const journal = entry ? journals.find((j) => j.id === entry.journalId) : undefined;
  const stateKey = entry ? `enum.state.${entry.state.toLowerCase()}` : "";
  const reference = entry ? (entry.sequenceNumber ?? entry.reference ?? intl.formatMessage({ id: "journalEntries.noReference" })) : "";

  return (
    <FormDialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={entry ? intl.formatMessage({ id: "journalEntries.viewTitle" }, { reference }) : ""}
      size="lg"
    >
      {entry && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.date" })}</dt>
              <dd>{formatDisplayDate(entry.date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.journal" })}</dt>
              <dd>{journal ? `${journal.name} (${journal.code})` : entry.journalId}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.description" })}</dt>
              <dd>{entry.description ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.reference" })}</dt>
              <dd>{entry.reference ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.state" })}</dt>
              <dd>
                <Badge variant={documentStateBadgeVariant(entry.state)}>{stateKey in intl.messages ? intl.formatMessage({ id: stateKey }) : entry.state}</Badge>
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalGrid.remarks" })}</dt>
              <dd className="whitespace-pre-wrap">{detail?.remarks ?? entry.remarks ?? "-"}</dd>
            </div>
          </dl>
          {entry.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "journalEntries.noLines" })}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{intl.formatMessage({ id: "ledger.account" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "common.description" })}</TableHead>
                  <TableHead className="text-right">{intl.formatMessage({ id: "ledger.debit" })}</TableHead>
                  <TableHead className="text-right">{intl.formatMessage({ id: "ledger.credit" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.lines.map((line) => {
                  const account = accounts.find((a) => a.id === line.accountId);
                  return (
                    <TableRow key={line.id}>
                      <TableCell>{account ? `${account.code} ${account.name}` : line.accountId}</TableCell>
                      <TableCell>{line.description ?? "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(line.debit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(line.credit)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {detailQuery.error && (
            <Alert variant="destructive">
              <AlertDescription>{getApiErrorMessage(detailQuery.error, intl.formatMessage({ id: "journalEntries.detailError" }))}</AlertDescription>
            </Alert>
          )}
          {source && (
            <section data-testid="journal-source-document" className="flex flex-col gap-3 border-t pt-4">
              <h3 className="text-sm font-medium">{intl.formatMessage({ id: "journalEntries.sourceDocument" })}</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.sourceNumber" })}</dt>
                  <dd>{sourceLink ? <Link className="text-primary underline-offset-4 hover:underline" to={sourceLink}>{source.documentNumber ?? intl.formatMessage({ id: "journalEntries.sourceOpen" })}</Link> : (source.documentNumber ?? "-")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.date" })}</dt>
                  <dd>{source.date ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.sourcePartner" })}</dt>
                  <dd>{partnerLink && source.partnerName ? <Link className="text-primary underline-offset-4 hover:underline" to={partnerLink}>{source.partnerName}</Link> : (source.partnerName ?? "-")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.sourceNotes" })}</dt>
                  <dd className="whitespace-pre-wrap">{source.notes ?? "-"}</dd>
                </div>
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{intl.formatMessage({ id: "common.description" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "common.quantity" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "journalEntries.sourceUnitPrice" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "journalEntries.sourceNet" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "journalEntries.sourceTax" })}</TableHead>
                    <TableHead className="text-right">{intl.formatMessage({ id: "journalEntries.sourceGross" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {source.lines.map((line, index) => (
                    <TableRow key={index}>
                      <TableCell>{line.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(line.unitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(line.netAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(line.taxAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(line.grossAmount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell colSpan={3}>{intl.formatMessage({ id: "common.total" })}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(source.netAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(source.taxAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(source.grossAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {sourceLink && (
                <Link className="self-start text-sm text-primary underline-offset-4 hover:underline" to={sourceLink}>
                  {intl.formatMessage({ id: "journalEntries.sourceOpen" })}
                </Link>
              )}
            </section>
          )}
        </div>
      )}
    </FormDialog>
  );
}
