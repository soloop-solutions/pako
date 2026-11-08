import { useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { JournalEntryResponse, JournalResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { serverSideColumns, usePagedGrid } from "@/components/data-grid/usePagedGrid";
import { documentStateBadgeVariant, getDocumentRowClassName } from "@/lib/document-types";
import { useMyAccess } from "@/hooks/useMyAccess";

const GRID_ID = "journalEntries";

type JournalEntriesTableProps = {
  companyId: string;
  journals: JournalResponse[];
  fromDate?: string;
  toDate?: string;
  sortOrder?: "newest" | "oldest";
  onPosted: () => void;
  onOpenEntry?: (entry: JournalEntryResponse) => void;
};

export function JournalEntriesTable({ companyId, journals, fromDate, toDate, sortOrder = "newest", onPosted, onOpenEntry }: JournalEntriesTableProps) {
  const intl = useIntl();
  const { canApprove } = useMyAccess();
  const [postingId, setPostingId] = useState<string | null>(null);
  const [postErrors, setPostErrors] = useState<Record<string, string>>({});

  const paged = usePagedGrid<JournalEntryResponse>({
    gridId: GRID_ID,
    enabled: true,
    queryKey: ["journal-entries-paged", companyId, fromDate ?? "", toDate ?? "", sortOrder],
    defaultPageSize: 100,
    fetchPage: async ({ page, pageSize, search, sort }) => {
      const result = await apiClient.paged3(
        companyId,
        page,
        pageSize,
        search,
        fromDate || undefined,
        toDate || undefined,
        sort ?? (sortOrder === "oldest" ? "date" : "-date"),
      );
      return { items: result.items, total: result.total };
    },
  });
  const entries = paged.items;
  const setPage = paged.urlState.setPage;

  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate, sortOrder, setPage]);

  function journalLabel(journalId: string) {
    const journal = journals.find((j) => j.id === journalId);
    return journal ? `${journal.name} (${journal.code})` : journalId;
  }

  async function handlePost(entryId: string) {
    setPostingId(entryId);
    setPostErrors((prev) => ({ ...prev, [entryId]: "" }));
    try {
      await apiClient.post3(companyId, entryId);
      await paged.query.refetch();
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
        accessorKey: "description",
        header: intl.formatMessage({ id: "journalEntries.description" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        accessorKey: "reference",
        header: intl.formatMessage({ id: "journalEntries.reference" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        accessorKey: "remarks",
        header: intl.formatMessage({ id: "journalEntries.remarks" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "journalEntries.state" }),
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Badge variant={documentStateBadgeVariant(state)}>{state}</Badge>;
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
              {entry.state === "Draft" && canApprove("accounting") && (
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

  const visibleColumns = useMemo(() => serverSideColumns(columns, ["date", "description", "state", "sequenceNumber"]), [columns]);

  return (
    <DataGrid
      gridId={GRID_ID}
      columns={visibleColumns}
      data={entries}
      rowCount={paged.total}
      isLoading={paged.query.isPending}
      getRowId={(row) => row.id}
      getRowClassName={(row) => getDocumentRowClassName(row.state)}
      onRowClick={onOpenEntry}
      enableGlobalFilter
      emptyMessage={intl.formatMessage({ id: "ledger.noJournalEntries" })}
      exportFileName="journal-entries"
      defaultPageSize={100}
      pageSizeOptions={[50, 100, 200]}
    />
  );
}
