import { useState } from "react";
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
      setPostErrors((prev) => ({ ...prev, [entryId]: getApiErrorMessage(err, "Could not post this entry.") }));
    } finally {
      setPostingId(null);
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Journal</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Sequence</TableHead>
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
                    {postingId === entry.id ? "Posting..." : "Post"}
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
