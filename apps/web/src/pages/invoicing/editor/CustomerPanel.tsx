import { useIntl } from "react-intl";
import type { CreditExposureResponse, PartnerResponse } from "@pako/shared";

import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { SearchableSelect, type SelectFavoritesConfig } from "@/components/ui/searchable-select";
import { partnerOptionLabel } from "@/lib/partners";

// Client request 2026-11-23: the invoice screen shows who is being invoiced — address, NUI, VAT
// number, contact, payment terms and the credit position — not only a name in a dropdown.
export function CustomerPanel({
  customers,
  partnerId,
  onChange,
  error,
  favorites,
  onCreateCustomer,
  creditExposure,
  documentGross,
  currency,
}: {
  customers: PartnerResponse[];
  partnerId: string;
  onChange: (partnerId: string) => void;
  error?: string | null;
  favorites?: SelectFavoritesConfig;
  onCreateCustomer?: () => void;
  creditExposure: CreditExposureResponse | null;
  /** The document's total from the server quote, for the "would exceed the credit limit" warning. */
  documentGross: number | undefined;
  currency: string;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const customer = customers.find((c) => c.id === partnerId);
  const fmt = (n: number) => `${n.toFixed(2)} ${currency}`;

  const address = [customer?.streetAddress, [customer?.postalCode, customer?.city].filter(Boolean).join(" "), customer?.country]
    .filter((part) => part && part.trim() !== "")
    .join(", ");

  const limit = creditExposure?.creditLimit;
  const available = creditExposure?.available;
  const isOverLimit = limit != null && available != null && available < 0;
  const wouldExceed = limit != null && !isOverLimit && available != null && (documentGross ?? 0) > 0 && (documentGross ?? 0) > available;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="invoice-customer-heading">
      <h3 id="invoice-customer-heading" className="text-sm font-semibold">{t("invoiceEditor.customerSection")}</h3>
      <FormField label={t("invoiceForm.customer")} htmlFor="invoice-customer" error={error} required>
        <SearchableSelect
          id="invoice-customer"
          value={partnerId}
          onChange={onChange}
          placeholder={t("invoiceForm.selectCustomer")}
          searchPlaceholder={t("common.search")}
          noResultsText={t("common.noResults")}
          emptyOptionLabel={t("invoiceForm.selectCustomer")}
          aria-invalid={!!error}
          options={customers.map((c) => ({ value: c.id, label: partnerOptionLabel(c, intl), description: c.taxNumber ?? undefined }))}
          favorites={favorites}
          createAction={onCreateCustomer ? { label: t("invoicing.addCustomer"), onClick: onCreateCustomer } : undefined}
        />
      </FormField>

      {customer ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-testid="invoice-customer-details">
          {address && (
            <>
              <dt className="text-muted-foreground">{t("invoiceEditor.address")}</dt>
              <dd>{address}</dd>
            </>
          )}
          {customer.taxNumber && (
            <>
              <dt className="text-muted-foreground">{t("invoiceDoc.nui")}</dt>
              <dd className="tabular-nums">{customer.taxNumber}</dd>
            </>
          )}
          {customer.fiscalNumber && (
            <>
              <dt className="text-muted-foreground">{t("invoiceDoc.personalNumber")}</dt>
              <dd className="tabular-nums">{customer.fiscalNumber}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t("invoiceDoc.vatNumber")}</dt>
          <dd>
            {customer.isVatRegistered
              ? <span className="tabular-nums">{customer.vatNumber || "—"}</span>
              : <Badge variant="outline">{t("invoiceEditor.notVatRegistered")}</Badge>}
          </dd>
          {customer.contactPerson && (
            <>
              <dt className="text-muted-foreground">{t("invoiceDoc.contactPerson")}</dt>
              <dd>{customer.contactPerson}</dd>
            </>
          )}
          {(customer.phone || customer.email) && (
            <>
              <dt className="text-muted-foreground">{t("invoiceEditor.contact")}</dt>
              <dd>{[customer.phone, customer.email].filter(Boolean).join(" · ")}</dd>
            </>
          )}
          {customer.paymentTermDays != null && (
            <>
              <dt className="text-muted-foreground">{t("invoiceDoc.paymentTerms")}</dt>
              <dd>{t("invoiceDoc.netDays", { days: customer.paymentTermDays })}</dd>
            </>
          )}
          {creditExposure && (
            <>
              <dt className="text-muted-foreground">{t("invoiceEditor.outstanding")}</dt>
              <dd className="tabular-nums">{fmt(creditExposure.outstanding)}</dd>
            </>
          )}
          {limit != null && (
            <>
              <dt className="text-muted-foreground">{t("invoiceEditor.creditLimit")}</dt>
              <dd className="tabular-nums">{t("invoiceEditor.creditLimitValue", { limit: fmt(limit), available: fmt(available ?? 0) })}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{t("invoiceEditor.pickCustomerHint")}</p>
      )}

      {isOverLimit && (
        <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-sm font-medium text-destructive">
          {t("invoicing.creditLimit.overLimit", { amount: fmt(Math.abs(available ?? 0)) })}
        </p>
      )}
      {wouldExceed && (
        <p className="rounded-md bg-warning px-2 py-1.5 text-sm font-medium text-warning-foreground">
          {t("invoicing.creditLimit.wouldExceed")}
        </p>
      )}
    </section>
  );
}
