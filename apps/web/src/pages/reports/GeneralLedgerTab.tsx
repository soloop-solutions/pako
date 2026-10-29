import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { GeneralLedgerLine } from "@pako/shared";

import { DataGrid } from "@/components/data-grid/DataGrid";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { formatAmount } from "./helpers";
import { staticColumn } from "./reportColumns";
import { DateRangeFields, ReportShell } from "./ReportShell";
import { GENERAL_LEDGER_GRID_ID, GENERAL_LEDGER_SORTABLE, type useGeneralLedgerReport } from "./useGeneralLedgerReport";

export function GeneralLedgerTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof useGeneralLedgerReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, data } = report;

  const columns = useMemo<ColumnDef<GeneralLedgerLine>[]>(() => {
    const col = (id: string, header: string, accessorFn: (row: GeneralLedgerLine) => string | number, numeric = false) =>
      staticColumn<GeneralLedgerLine>({
        id,
        header,
        accessorFn,
        enableSorting: GENERAL_LEDGER_SORTABLE.has(id),
        ...(numeric ? { cell: ({ row }: { row: { original: GeneralLedgerLine } }) => formatAmount(accessorFn(row.original) as number) } : {}),
        meta: { numeric },
      });
    return [
      col("date", intl.formatMessage({ id: "common.date" }), (row) => row.date),
      col("entryNumber", intl.formatMessage({ id: "reports.glEntryNumber" }), (row) => row.entryNumber ?? ""),
      col("reference", intl.formatMessage({ id: "common.reference" }), (row) => row.reference ?? ""),
      col("account", intl.formatMessage({ id: "common.code" }), (row) => row.accountCode),
      col("accountName", intl.formatMessage({ id: "ledger.account" }), (row) => row.accountName),
      col("partnerName", intl.formatMessage({ id: "reports.glPartner" }), (row) => row.partnerName ?? ""),
      col("description", intl.formatMessage({ id: "common.description" }), (row) => row.description ?? ""),
      col("debit", intl.formatMessage({ id: "ledger.debit" }), (row) => row.debit, true),
      col("credit", intl.formatMessage({ id: "ledger.credit" }), (row) => row.credit, true),
    ];
  }, [intl]);

  return (
    <ReportShell
      titleId="reports.generalLedger"
      companyName={companyName}
      periodEnd={period.to}
      accountingLockDate={accountingLockDate}
      onExport={report.exportFile}
      exporting={report.exporting}
      exportError={report.exportError}
      error={report.error}
      controls={
        <>
          <DateRangeFields idPrefix="general-ledger" from={period.from} to={period.to} onFrom={period.setFrom} onTo={period.setTo} />
          <div className="flex flex-col gap-2">
            <Label>{intl.formatMessage({ id: "reports.glAccountFilter" })}</Label>
            <Select
              className="w-56"
              aria-label={intl.formatMessage({ id: "reports.glAccountFilter" })}
              value={report.accountId ?? ""}
              onValueChange={(value) => period.setParam("accountId", value || null)}
              options={[
                { value: "", label: intl.formatMessage({ id: "reports.glAllAccounts" }) },
                ...report.accounts.map((account) => ({ value: account.id, label: `${account.code} ${account.name}` })),
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{intl.formatMessage({ id: "reports.glPartnerFilter" })}</Label>
            <Select
              className="w-56"
              aria-label={intl.formatMessage({ id: "reports.glPartnerFilter" })}
              value={report.partnerId ?? ""}
              onValueChange={(value) => period.setParam("partnerId", value || null)}
              options={[
                { value: "", label: intl.formatMessage({ id: "reports.glAllPartners" }) },
                ...report.partners.map((partner) => ({ value: partner.id, label: partner.name })),
              ]}
            />
          </div>
        </>
      }
    >
      <DataGrid<GeneralLedgerLine>
        gridId={GENERAL_LEDGER_GRID_ID}
        columns={columns}
        data={data?.items ?? []}
        rowCount={data?.total ?? 0}
        isLoading={report.loading && !data}
        getRowId={(row, index) => `${row.entryId}-${index}`}
        enableGlobalFilter
        globalFilterPlaceholder={intl.formatMessage({ id: "reports.glSearchPlaceholder" })}
      />
    </ReportShell>
  );
}
