import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  AccountResponse,
  BillResponse,
  ItemResponse,
  PartnerResponse,
  PaymentMethodResponse,
  TaxDefinitionResponse,
} from "@pako/shared";

import { fetchAllItems } from "@/api/fetchAllItems";
import { apiClient, getApiErrorMessage } from "@/api/client";
import { DocumentStateBadge } from "@/components/shared/DocumentStateBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/context/CompanyContext";
import { useTabMeta } from "@/context/TabsContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { BillDocumentType, billDocumentTypeLabel } from "@/lib/document-types";
import { taxesForPurchase } from "@/lib/tax-enums";
import { BillForm } from "@/pages/bills/BillForm";

export type BillEditorKind = "bill" | "purchaseReturn";

const LIST_PATH: Record<BillEditorKind, string> = { bill: "/bills", purchaseReturn: "/purchase-returns" };
const NEW_TITLE: Record<BillEditorKind, string> = { bill: "bills.newBill", purchaseReturn: "purchaseReturns.newReturn" };

const isReturn = (bill: BillResponse) => bill.documentType === BillDocumentType.PurchaseReturn;
const detailPath = (bill: BillResponse) => `${isReturn(bill) ? "/purchase-returns" : "/bills"}/${bill.id}`;

// User decision 2026-11-24 ("yes they should"): bills, like invoices (client request 2026-11-23), are
// created and edited on a full page rather than in a dialog. Routes: /bills/new, /purchase-returns/new,
// /bills/:id/edit and /purchase-returns/:id/edit. The form itself is the same BillForm.
export function BillEditorPage({ kind }: { kind: BillEditorKind }) {
  const intl = useIntl();
  const navigate = useNavigate();
  const { id } = useParams();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  const [items, setItems] = useState<ItemResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [bill, setBill] = useState<BillResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, taxesResult, paymentMethodsResult, itemsResult, accountsResult, billResult] = await Promise.all([
        apiClient.partnersAll(companyId, undefined),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
        fetchAllItems(companyId),
        apiClient.accountsAll(companyId),
        id ? apiClient.billsGET(companyId, id) : Promise.resolve(null),
      ]);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);
      setItems(itemsResult.items);
      setAccounts(accountsResult);
      if (billResult) setBill(billResult);
      setLoaded(true);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "bills.loadError" })));
    }
  }, [companyId, id, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const editable = !id || (bill != null && (bill.state === "Draft" || bill.state === "Posted"));
  const title = id
    ? intl.formatMessage(
        { id: "invoiceEditor.editTitle" },
        { number: bill?.vendorReference ?? intl.formatMessage({ id: !bill || bill.state === "Draft" ? "billDetail.draftBill" : "billDetail.title" }) },
      )
    : intl.formatMessage({ id: NEW_TITLE[kind] });

  // As the invoice page: leaving by a link or Back asks first; Save and Cancel replace the history
  // entry, so they never ask.
  useUnsavedChanges(loaded && editable);
  useTabMeta({ title, dirty: loaded && editable });

  const listPath = bill ? (isReturn(bill) ? "/purchase-returns" : "/bills") : LIST_PATH[kind];
  const leave = useCallback((path: string) => navigate(path, { replace: true }), [navigate]);

  const handleCreated = useCallback(
    (options?: { keepOpen?: boolean; bill?: BillResponse }) => {
      if (options?.keepOpen || !options?.bill) {
        setFormKey((k) => k + 1);
        void refresh();
        return;
      }
      leave(detailPath(options.bill));
    },
    [leave, refresh],
  );

  if (!activeCompany) {
    return <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const fixedDocumentType = bill
    ? isReturn(bill)
      ? BillDocumentType.PurchaseReturn
      : undefined
    : kind === "purchaseReturn"
      ? BillDocumentType.PurchaseReturn
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={id && bill ? detailPath(bill) : listPath}>← {intl.formatMessage({ id: "invoiceEditor.back" })}</Link>
        </Button>
        <h2 className="text-xl font-semibold">{title}</h2>
        {bill && (
          <>
            <Badge variant="outline">{billDocumentTypeLabel(bill.documentType, intl)}</Badge>
            <DocumentStateBadge state={bill.state} />
          </>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loaded && !editable && (
        <Alert>
          <AlertDescription>{intl.formatMessage({ id: "invoiceEditor.notEditable" })}</AlertDescription>
        </Alert>
      )}

      {loaded && editable && (
        <BillForm
          key={formKey}
          companyId={activeCompany.id}
          vendors={partners.filter((p) => p.isVendor && (p.isActive !== false || p.id === bill?.partnerId))}
          taxes={taxesForPurchase(taxes)}
          paymentMethods={paymentMethods}
          items={items}
          accounts={accounts}
          isVatRegistered={activeCompany.isVatRegistered}
          editingBill={bill ?? undefined}
          fixedDocumentType={fixedDocumentType}
          onCreated={handleCreated}
          onSaved={() => bill && leave(detailPath(bill))}
          onCancel={() => leave(id && bill ? detailPath(bill) : listPath)}
          onPartnerCreated={() => void refresh()}
          onItemCreated={() => void refresh()}
        />
      )}
    </div>
  );
}
