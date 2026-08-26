import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { PartnerResponse, TaxDefinitionResponse } from '@pako/shared';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { DocumentLinesEditor, EMPTY_DOCUMENT_LINE, type DocumentLine } from '@/components/shared/document-lines-editor';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';
import { taxesForSale } from '@/lib/tax-enums';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewInvoiceScreen() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [customers, setCustomers] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [lines, setLines] = useState<DocumentLine[]>([{ ...EMPTY_DOCUMENT_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadOptions = useCallback(async () => {
    if (!companyId) return;
    try {
      const [partnersResult, taxesResult] = await Promise.all([apiClient.partnersAll(companyId), apiClient.taxes(companyId)]);
      setCustomers(partnersResult.filter((p) => p.isCustomer));
      setTaxes(taxesForSale(taxesResult));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load customers.'));
    }
  }, [companyId]);

  useEffect(() => {
    void (async () => {
      await loadOptions();
    })();
  }, [loadOptions]);

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
      setError('Select a customer.');
      return;
    }
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) {
      setError('Add at least one line.');
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.invoicesPOST(companyId, {
        partnerId,
        issueDate,
        dueDate,
        lines: validLines.map((line) => ({
          description: line.description,
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          taxDefinitionId: line.taxDefinitionId || undefined,
          revenueAccountId: undefined,
        })),
      });
      router.back();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not create the invoice.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      {error && <ErrorBanner message={error} />}

      <SelectField
        label="Customer"
        value={partnerId}
        onChange={setPartnerId}
        options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
        placeholder="Select customer"
      />
      <TextField label="Issue date (YYYY-MM-DD)" value={issueDate} onChangeText={setIssueDate} />
      <TextField label="Due date (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} />

      <DocumentLinesEditor lines={lines} taxes={taxes} onUpdateLine={updateLine} onAddLine={addLine} onRemoveLine={removeLine} />

      <Button title={submitting ? 'Creating...' : 'Create invoice'} onPress={handleSubmit} loading={submitting} />
    </Screen>
  );
}
