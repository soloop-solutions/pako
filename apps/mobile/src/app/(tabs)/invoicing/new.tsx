import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import type { InvoiceResponse, PartnerResponse, TaxDefinitionResponse } from '@pako/shared';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { DocumentLinesEditor, EMPTY_DOCUMENT_LINE, type DocumentLine } from '@/components/shared/document-lines-editor';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';
import {
  INVOICE_DOCUMENT_TYPE_CREDIT_NOTE,
  INVOICE_DOCUMENT_TYPE_DEBIT_NOTE,
  INVOICE_DOCUMENT_TYPE_INVOICE,
  invoiceDocumentTypeOptions,
} from '@/lib/document-enums';
import { taxesForSale } from '@/lib/tax-enums';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewInvoiceScreen() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const intl = useIntl();

  const [customers, setCustomers] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [documentType, setDocumentType] = useState(String(INVOICE_DOCUMENT_TYPE_INVOICE));
  const [originalInvoiceId, setOriginalInvoiceId] = useState('');
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [lines, setLines] = useState<DocumentLine[]>([{ ...EMPTY_DOCUMENT_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadOptions = useCallback(async () => {
    if (!companyId) return;
    try {
      const [partnersResult, taxesResult, invoicesResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.invoicesAll(companyId),
      ]);
      setCustomers(partnersResult.filter((p) => p.isCustomer));
      setTaxes(taxesForSale(taxesResult));
      setInvoices(invoicesResult);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'invoiceForm.loadError' })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void (async () => {
      await loadOptions();
    })();
  }, [loadOptions]);

  const needsOriginalInvoice =
    documentType === String(INVOICE_DOCUMENT_TYPE_CREDIT_NOTE) || documentType === String(INVOICE_DOCUMENT_TYPE_DEBIT_NOTE);

  const originalInvoiceOptions = useMemo(() => {
    const candidates = invoices.filter(
      (invoice) => invoice.partnerId === partnerId && invoice.documentType === INVOICE_DOCUMENT_TYPE_INVOICE && invoice.state === 'Posted',
    );
    return [{ value: '', label: intl.formatMessage({ id: 'select.none' }) }, ...candidates.map((invoice) => ({ value: invoice.id, label: invoice.invoiceNumber ?? invoice.id }))];
  }, [invoices, partnerId, intl]);

  function updateLine(index: number, patch: Partial<DocumentLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_DOCUMENT_LINE }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!companyId) return;
    setError(null);

    if (!partnerId) {
      setError(intl.formatMessage({ id: 'invoiceForm.selectCustomerError' }));
      return;
    }
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) {
      setError(intl.formatMessage({ id: 'invoiceForm.addLineError' }));
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.invoicesPOST(companyId, {
        partnerId,
        issueDate,
        dueDate,
        documentType: Number(documentType),
        originalInvoiceId: needsOriginalInvoice && originalInvoiceId ? originalInvoiceId : undefined,
        lines: validLines.map((line) => ({
          description: line.description,
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          taxDefinitionId: line.taxDefinitionId || undefined,
          revenueAccountId: undefined,
          discountPercent: parseFloat(line.discountPercent) || 0,
        })),
      });
      router.back();
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'invoiceForm.createError' })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      {error && <ErrorBanner message={error} />}

      <SelectField
        label={intl.formatMessage({ id: 'invoiceForm.customer' })}
        value={partnerId}
        onChange={(value) => {
          setPartnerId(value);
          setOriginalInvoiceId('');
        }}
        options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
        placeholder={intl.formatMessage({ id: 'invoiceForm.selectCustomer' })}
      />
      <SelectField
        label={intl.formatMessage({ id: 'invoiceForm.documentType' })}
        value={documentType}
        onChange={(value) => {
          setDocumentType(value);
          setOriginalInvoiceId('');
        }}
        options={invoiceDocumentTypeOptions(intl)}
      />
      {needsOriginalInvoice && (
        <SelectField
          label={intl.formatMessage({ id: 'invoiceForm.originalInvoice' })}
          value={originalInvoiceId}
          onChange={setOriginalInvoiceId}
          options={originalInvoiceOptions}
          placeholder={intl.formatMessage({ id: 'select.none' })}
        />
      )}
      <TextField label={intl.formatMessage({ id: 'invoiceForm.issueDate' })} value={issueDate} onChangeText={setIssueDate} />
      <TextField label={intl.formatMessage({ id: 'invoiceForm.dueDate' })} value={dueDate} onChangeText={setDueDate} />

      <DocumentLinesEditor lines={lines} taxes={taxes} onUpdateLine={updateLine} onAddLine={addLine} onRemoveLine={removeLine} />

      <Button title={submitting ? intl.formatMessage({ id: 'invoiceForm.creating' }) : intl.formatMessage({ id: 'invoiceForm.createInvoice' })} onPress={handleSubmit} loading={submitting} />
    </Screen>
  );
}
