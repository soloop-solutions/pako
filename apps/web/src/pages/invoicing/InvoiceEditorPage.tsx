import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  AccountResponse,
  InvoiceResponse,
  ItemResponse,
  PartnerResponse,
  PaymentMethodResponse,
  TaxDefinitionResponse,
} from "@pako/shared";

import { fetchAllItems } from "@/api/fetchAllItems";
import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/context/CompanyContext";
import { useTabMeta } from "@/context/TabsContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { documentStateBadgeVariant, InvoiceDocumentType, invoiceDocumentTypeLabel } from "@/lib/document-types";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";
import { useInvoicePrefill } from "@/pages/invoicing/invoicePrefill";

export type InvoiceEditorKind = "invoice" | "proforma" | "salesReturn";

const LIST_PATH: Record<InvoiceEditorKind, string> = { invoice: "/invoicing", proforma: "/proforma", salesReturn: "/sales-returns" };
const NEW_TITLE: Record<InvoiceEditorKind, string> = {
  invoice: "invoicing.newInvoice",
  proforma: "proforma.newProforma",
  salesReturn: "salesReturns.newReturn",
};

// Client request 2026-11-23: creating or editing a sales invoice (and a proforma or sales return,
// which share the form) is a full page rather than a dialog — customer and document panels, a line
// table, server-quoted totals and a sticky action bar. Routes: /invoicing/new (?salesOrder= /
// ?delivery= prefill, docs/POS_PLAN.md P6), /proforma/new, /sales-returns/new and
// /invoicing/:id/edit, /sales-returns/:id/edit.
export function InvoiceEditorPage({ kind }: { kind: InvoiceEditorKind }) {
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
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const prefill = useInvoicePrefill(kind === "invoice" && !id ? companyId : null, intl.formatMessage({ id: "dist.invoice.nothingToInvoice" }));

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, taxesResult, paymentMethodsResult, itemsResult, accountsResult, invoiceResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
        fetchAllItems(companyId),
        apiClient.accountsAll(companyId),
        id ? apiClient.invoicesGET(companyId, id) : Promise.resolve(null),
      ]);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);
      setItems(itemsResult.items);
      setAccounts(accountsResult);
      if (invoiceResult) setInvoice(invoiceResult);
      setLoaded(true);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "invoicing.loadError" })));
    }
  }, [companyId, id, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const editable = !id || (invoice != null && (invoice.state === "Draft" || invoice.state === "Posted"));
  const title = id
    ? intl.formatMessage({ id: "invoiceEditor.editTitle" }, { number: invoice?.invoiceNumber ?? intl.formatMessage({ id: "invoiceDetail.draftInvoice" }) })
    : intl.formatMessage({ id: NEW_TITLE[kind] });

  // The page is a form from the moment it opens; leaving it by a link or Back asks first, as the
  // inline editor did. Save and Cancel move on with a history *replace*, which takes the guard's
  // history entry with it, so they never ask.
  useUnsavedChanges(loaded && editable);
  useTabMeta({ title, dirty: loaded && editable });

  const detailPath = (target: InvoiceResponse) =>
    `${target.documentType === InvoiceDocumentType.SalesReturn ? "/sales-returns" : "/invoicing"}/${target.id}`;
  const listPath = invoice ? (invoice.documentType === InvoiceDocumentType.SalesReturn ? "/sales-returns" : "/invoicing") : LIST_PATH[kind];

  function leave(path: string) {
    navigate(path, { replace: true });
  }

  const handleCreated = useCallback(
    (options?: { keepOpen?: boolean; invoice?: InvoiceResponse }) => {
      if (prefill.active) prefill.clear();
      if (options?.keepOpen || !options?.invoice) {
        setFormKey((k) => k + 1);
        void refresh();
        return;
      }
      leave(detailPath(options.invoice));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefill.active, refresh],
  );

  if (!activeCompany) {
    return <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={id && invoice ? detailPath(invoice) : listPath}>← {intl.formatMessage({ id: "invoiceEditor.back" })}</Link>
        </Button>
        <h2 className="text-xl font-semibold">{title}</h2>
        {invoice && (
          <>
            <Badge variant="outline">{invoiceDocumentTypeLabel(invoice.documentType, intl)}</Badge>
            <Badge variant={documentStateBadgeVariant(invoice.state)}>{invoice.state}</Badge>
          </>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {prefill.active && prefill.error != null && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(prefill.error, intl.formatMessage({ id: "dist.invoice.prefillError" }))}</AlertDescription>
        </Alert>
      )}
      {prefill.isPending && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "dist.invoice.prefillLoading" })}</p>}
      {loaded && !editable && (
        <Alert>
          <AlertDescription>{intl.formatMessage({ id: "invoiceEditor.notEditable" })}</AlertDescription>
        </Alert>
      )}

      {loaded && editable && !prefill.isPending && (
        <InvoiceForm
          key={`${formKey}${prefill.prefill ? "-prefill" : ""}`}
          companyId={activeCompany.id}
          customers={partners.filter((p) => p.isCustomer)}
          taxes={taxesForSale(taxes)}
          paymentMethods={paymentMethods}
          items={items}
          accounts={accounts}
          isVatRegistered={activeCompany.isVatRegistered}
          prefill={prefill.prefill}
          editingInvoice={invoice ?? undefined}
          fixedDocumentType={
            invoice
              ? invoice.documentType === InvoiceDocumentType.SalesReturn || invoice.documentType === InvoiceDocumentType.Proforma
                ? invoice.documentType
                : undefined
              : kind === "proforma"
                ? InvoiceDocumentType.Proforma
                : kind === "salesReturn"
                  ? InvoiceDocumentType.SalesReturn
                  : undefined
          }
          onCreated={handleCreated}
          onSaved={() => invoice && leave(detailPath(invoice))}
          onCancel={() => leave(id && invoice ? detailPath(invoice) : listPath)}
          onPartnerCreated={() => void refresh()}
          onItemCreated={() => void refresh()}
        />
      )}
    </div>
  );
}
