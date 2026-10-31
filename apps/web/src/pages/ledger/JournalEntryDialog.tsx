import { useIntl } from "react-intl";
import type { AccountResponse, JournalEntryResponse, JournalResponse } from "@pako/shared";

import { Badge } from "@/components/ui/badge";
import { FormDialog } from "@/components/shared/FormDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { documentStateBadgeVariant } from "@/lib/document-types";

interface JournalEntryDialogProps {
  entry: JournalEntryResponse | null;
  accounts: AccountResponse[];
  journals: JournalResponse[];
  onClose: () => void;
}

export function JournalEntryDialog({ entry, accounts, journals, onClose }: JournalEntryDialogProps) {
  const intl = useIntl();
  const journal = entry ? journals.find((j) => j.id === entry.journalId) : undefined;
  const reference = entry ? (entry.sequenceNumber ?? entry.reference ?? intl.formatMessage({ id: "journalEntries.noReference" })) : "";

  return (
    <FormDialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={entry ? intl.formatMessage({ id: "journalEntries.viewTitle" }, { reference }) : ""}
      description={entry?.remarks}
      size="lg"
    >
      {entry && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.date" })}</dt>
              <dd>{entry.date}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.journal" })}</dt>
              <dd>{journal ? `${journal.name} (${journal.code})` : entry.journalId}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.reference" })}</dt>
              <dd>{entry.reference ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalEntries.state" })}</dt>
              <dd>
                <Badge variant={documentStateBadgeVariant(entry.state)}>{entry.state}</Badge>
              </dd>
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
                      <TableCell className="text-right tabular-nums">{line.debit.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.credit.toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </FormDialog>
  );
}
