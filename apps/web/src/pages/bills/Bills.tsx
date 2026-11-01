import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  AccountResponse,
  BillResponse,
  DocumentBalanceResponse,
  ItemResponse,
  PartnerResponse,
  PaymentMethodResponse,
  TaxDefinitionResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { BillDocumentType, billDocumentTypeLabel, documentStateBadgeVariant, getDocumentRowClassName } from "@/lib/document-types";
import { taxesForPurchase } from "@/lib/tax-enums";
import { BillForm } from "@/pages/bills/BillForm";
import { PartnerForm } from "@/pages/shared/PartnerForm";

const GRID_ID = "bills";

export function Bills() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [bills, setBills] = useState<BillResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  // F5 — see Invoicing.tsx's identical fields for the full rationale.
  const [items, setItems] = useState<ItemResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [billFormOpen, setBillFormOpen] = useState(false);
  const [vendorFormOpen, setVendorFormOpen] = useState(false);
  const [billFormKey, setBillFormKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, billsResult, taxesResult, paymentMethodsResult, itemsResult, accountsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.billsAll(companyId),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
        apiClient.itemsGET(companyId, 1, 200, undefined, undefined),
        apiClient.accountsAll(companyId),
      ]);
      setPartners(partnersResult);
      setBills(billsResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);
      setItems(itemsResult.items);
      setAccounts(accountsResult);

      const balanceEntries = await Promise.all(
        billsResult.map(async (bill) => [bill.id, await apiClient.balance(companyId, bill.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "bills.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const vendors = partners.filter((p) => p.isVendor);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  // A6 (v2 release): Purchase returns have their own page now — see Invoicing.tsx's identical
  // displayedInvoices comment for the full rationale.
  // `balances` is a dependency here too — see Invoicing.tsx's identical comment for why a
  // balance-dependent column needs the `data` array reference to change when balances update.
  const displayedBills = useMemo(
    () => bills.filter((bill) => bill.documentType !== BillDocumentType.PurchaseReturn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills, balances],
  );

  const columns = useMemo<ColumnDef<BillResponse>[]>(
    () => [
      {
        accessorKey: "vendorReference",
        header: intl.formatMessage({ id: "bills.vendorInvoiceNumber" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        id: "type",
        header: intl.formatMessage({ id: "common.type" }),
        accessorFn: (row) => billDocumentTypeLabel(row.documentType, intl),
        cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
      },
      {
        id: "vendor",
        header: intl.formatMessage({ id: "common.vendor" }),
        accessorFn: (row) => partnerName(row.partnerId),
      },
      {
        accessorKey: "issueDate",
        header: intl.formatMessage({ id: "invoicing.issueDate" }),
      },
      {
        accessorKey: "dueDate",
        header: intl.formatMessage({ id: "invoicing.dueDate" }),
      },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "invoicing.state" }),
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Badge variant={documentStateBadgeVariant(state)}>{state}</Badge>;
        },
      },
      {
        id: "outstanding",
        header: intl.formatMessage({ id: "invoicing.outstanding" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        accessorFn: (row) => (row.state === "Posted" ? balances[row.id]?.outstanding : undefined),
        cell: ({ getValue, row }) => {
          const value = getValue() as number | undefined;
          if (row.original.state !== "Posted") return "-";
          return value !== undefined ? value.toFixed(2) : "...";
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Link className="text-sm font-medium text-primary hover:underline" to={`/bills/${row.original.id}`}>
            {intl.formatMessage({ id: "common.view" })}
          </Link>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners, balances],
  );

  const handleBillCreated = useCallback(async () => {
    setBillFormOpen(false);
    setBillFormKey((k) => k + 1);
    await refresh();
  }, [refresh]);

  const handleVendorCreated = useCallback(async () => {
    setVendorFormOpen(false);
    await refresh();
  }, [refresh]);

  const handleInlinePartnerCreated = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const handleInlineItemCreated = useCallback(async () => {
    await refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "bills.title" })}</CardTitle>
        </CardHeader>
        <p className="p-6 text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "bills.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "bills.description" })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setVendorFormOpen(true)}>
            {intl.formatMessage({ id: "bills.addVendor" })}
          </Button>
          <Button onClick={() => setBillFormOpen(true)}>
            {intl.formatMessage({ id: "bills.newBill" })}
          </Button>
        </div>
      </div>

      <FormDialog
        open={vendorFormOpen}
        onOpenChange={(open) => { if (!open) setVendorFormOpen(false); }}
        title={intl.formatMessage({ id: "bills.addVendor" })}
        size="sm"
      >
        <PartnerForm companyId={activeCompany.id} role="vendor" onCreated={handleVendorCreated} />
      </FormDialog>

      <FormDialog
        open={billFormOpen}
        onOpenChange={(open) => { if (!open) setBillFormOpen(false); }}
        title={intl.formatMessage({ id: "bills.newBill" })}
        description={intl.formatMessage({ id: "bills.newBillDescription" })}
        size="full"
      >
        <BillForm
          key={billFormKey}
          companyId={activeCompany.id}
          vendors={vendors}
          taxes={taxesForPurchase(taxes)}
          bills={bills}
          paymentMethods={paymentMethods}
          items={items}
          accounts={accounts}
          isVatRegistered={activeCompany.isVatRegistered}
          onCreated={handleBillCreated}
          onPartnerCreated={handleInlinePartnerCreated}
          onItemCreated={handleInlineItemCreated}
        />
      </FormDialog>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "bills.billsTable" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={displayedBills}
            rowCount={displayedBills.length}
            getRowId={(row) => row.id}
            getRowClassName={(row) => getDocumentRowClassName(row.state)}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "bills.noBills" })}
            exportFileName="bills"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
