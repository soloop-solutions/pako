import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { JournalEntryResponse, JournalResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/data-grid/DataGrid";

const GRID_ID = "journalEntries";

type JournalEntriesTableProps = {
  companyId: string;
  entries: JournalEntryResponse[];
  journals: JournalResponse[];
  onPosted: () => void;
  isLoading?: boolean;
};

export function JournalEntriesTable({ companyId, entries, journals, onPosted, isLoading }: JournalEntriesTableProps) {
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

  const columns = useMemo<ColumnDef<JournalEntryResponse>[]>(
    () => [
      {
        accessorKey: "date",
        header: intl.formatMessage({ id: "journalEntries.date" }),
      },
      {
        id: "journal",
        header: intl.formatMessage({ id: "journalEntries.journal" }),
        accessorFn: (row) => journalLabel(row.journalId),
      },
      {
        accessorKey: "reference",
        header: intl.formatMessage({ id: "journalEntries.reference" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "journalEntries.state" }),
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Badge variant={state === "Posted" ? "default" : "secondary"}>{state}</Badge>;
        },
      },
      {
        accessorKey: "sequenceNumber",
        header: intl.formatMessage({ id: "journalEntries.sequence" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => {
          const entry = row.original;
          return (
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
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, journals, postingId, postErrors],
  );

  return (
    <DataGrid
      gridId={GRID_ID}
      columns={columns}
      data={entries}
      rowCount={entries.length}
      isLoading={isLoading}
      getRowId={(row) => row.id}
      enableGlobalFilter
      emptyMessage={intl.formatMessage({ id: "ledger.noJournalEntries" })}
      exportFileName="journal-entries"
      manualFiltering={false}
      manualSorting={false}
      manualGrouping={false}
      defaultPageSize={100}
      pageSizeOptions={[50, 100, 200]}
    />
  );
}
