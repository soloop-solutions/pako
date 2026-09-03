import { useState } from "react";
import { useIntl } from "react-intl";
import type { JournalEntryResponse, JournalResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type JournalEntriesTableProps = {
  companyId: string;
  entries: JournalEntryResponse[];
  journals: JournalResponse[];
  onPosted: () => void;
};

export function JournalEntriesTable({ companyId, entries, journals, onPosted }: JournalEntriesTableProps) {
  const intl = useIntl();
  const [postingId, setPostingId] = useState<string | null>(null);
  const [postErrors, setPostErrors] = useState<Record<string, string>>({});

  function journalLabel(journalId: string) {
    const journal = journals.find((j) => j.id === journalId);
    return journal ? `${journal.name} (${journal.code})` : journalId;
  }

  async function handlePost(entryId: string) {
    setPostingId(entryId);
    setPostErrors((prev) => ({ ...prev, [entryId]: "" }));
    try {
      await apiClient.post3(companyId, entryId);
      onPosted();
    } catch (err) {
      setPostErrors((prev) => ({ ...prev, [entryId]: getApiErrorMessage(err, intl.formatMessage({ id: "journalEntries.postError" })) }));
    } finally {
      setPostingId(null);
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{intl.formatMessage({ id: "journalEntries.date" })}</TableHead>
          <TableHead>{intl.formatMessage({ id: "journalEntries.journal" })}</TableHead>
          <TableHead>{intl.formatMessage({ id: "journalEntries.reference" })}</TableHead>
          <TableHead>{intl.formatMessage({ id: "journalEntries.state" })}</TableHead>
          <TableHead>{intl.formatMessage({ id: "journalEntries.sequence" })}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>{entry.date}</TableCell>
            <TableCell>{journalLabel(entry.journalId)}</TableCell>
            <TableCell>{entry.reference ?? "-"}</TableCell>
            <TableCell>
              <Badge variant={entry.state === "Posted" ? "default" : "secondary"}>{entry.state}</Badge>
            </TableCell>
            <TableCell>{entry.sequenceNumber ?? "-"}</TableCell>
            <TableCell>
              <div className="flex max-w-[16rem] flex-col items-start gap-1">
                {entry.state === "Draft" && (
                  <Button size="sm" onClick={() => handlePost(entry.id)} disabled={postingId === entry.id}>
                    {postingId === entry.id ? intl.formatMessage({ id: "journalEntries.posting" }) : intl.formatMessage({ id: "journalEntries.post" })}
                  </Button>
                )}
                {postErrors[entry.id] && (
                  <span className="text-xs whitespace-normal text-destructive">{postErrors[entry.id]}</span>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
