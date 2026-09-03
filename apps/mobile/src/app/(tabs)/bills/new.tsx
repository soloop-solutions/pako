import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import type { BillResponse, PartnerResponse, TaxDefinitionResponse } from '@pako/shared';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Screen } from '@/components/ui/screen';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { DocumentLinesEditor, EMPTY_DOCUMENT_LINE, type DocumentLine } from '@/components/shared/document-lines-editor';
import { apiClient, getApiErrorMessage } from '@/api/client';
import { useCompany } from '@/context/company-context';
import { BILL_DOCUMENT_TYPE_BILL, BILL_DOCUMENT_TYPE_CREDIT_NOTE, billDocumentTypeOptions } from '@/lib/document-enums';
import { taxesForPurchase } from '@/lib/tax-enums';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewBillScreen() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const intl = useIntl();

  const [vendors, setVendors] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [bills, setBills] = useState<BillResponse[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [documentType, setDocumentType] = useState(String(BILL_DOCUMENT_TYPE_BILL));
  const [originalBillId, setOriginalBillId] = useState('');
  const [vendorReference, setVendorReference] = useState('');
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [lines, setLines] = useState<DocumentLine[]>([{ ...EMPTY_DOCUMENT_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadOptions = useCallback(async () => {
    if (!companyId) return;
    try {
      const [partnersResult, taxesResult, billsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.billsAll(companyId),
      ]);
      setVendors(partnersResult.filter((p) => p.isVendor));
      setTaxes(taxesForPurchase(taxesResult));
      setBills(billsResult);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'billForm.loadError' })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void (async () => {
      await loadOptions();
    })();
  }, [loadOptions]);

  const needsOriginalBill = documentType === String(BILL_DOCUMENT_TYPE_CREDIT_NOTE);

  const originalBillOptions = useMemo(() => {
    const candidates = bills.filter(
      (bill) => bill.partnerId === partnerId && bill.documentType === BILL_DOCUMENT_TYPE_BILL && bill.state === 'Posted',
    );
    return [{ value: '', label: intl.formatMessage({ id: 'select.none' }) }, ...candidates.map((bill) => ({ value: bill.id, label: bill.vendorReference ?? bill.id }))];
  }, [bills, partnerId, intl]);

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
      setError(intl.formatMessage({ id: 'billForm.selectVendorError' }));
      return;
    }
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) {
      setError(intl.formatMessage({ id: 'billForm.addLineError' }));
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.billsPOST(companyId, {
        partnerId,
        vendorReference: vendorReference.trim() || undefined,
        issueDate,
        dueDate,
        documentType: Number(documentType),
        originalBillId: needsOriginalBill && originalBillId ? originalBillId : undefined,
        lines: validLines.map((line) => ({
          description: line.description,
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          taxDefinitionId: line.taxDefinitionId || undefined,
          expenseAccountId: undefined,
          discountPercent: parseFloat(line.discountPercent) || 0,
        })),
      });
      router.back();
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: 'billForm.createError' })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      {error && <ErrorBanner message={error} />}

      <SelectField
        label={intl.formatMessage({ id: 'billForm.vendor' })}
        value={partnerId}
        onChange={(value) => {
          setPartnerId(value);
          setOriginalBillId('');
        }}
        options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
        placeholder={intl.formatMessage({ id: 'billForm.selectVendor' })}
      />
      <SelectField
        label={intl.formatMessage({ id: 'billForm.documentType' })}
        value={documentType}
        onChange={(value) => {
          setDocumentType(value);
          setOriginalBillId('');
        }}
        options={billDocumentTypeOptions(intl)}
      />
      {needsOriginalBill && (
        <SelectField
          label={intl.formatMessage({ id: 'billForm.originalBill' })}
          value={originalBillId}
          onChange={setOriginalBillId}
          options={originalBillOptions}
          placeholder={intl.formatMessage({ id: 'select.none' })}
        />
      )}
      <TextField label={intl.formatMessage({ id: 'billForm.vendorReference' })} value={vendorReference} onChangeText={setVendorReference} />
      <TextField label={intl.formatMessage({ id: 'billForm.issueDate' })} value={issueDate} onChangeText={setIssueDate} />
      <TextField label={intl.formatMessage({ id: 'billForm.dueDate' })} value={dueDate} onChangeText={setDueDate} />

      <DocumentLinesEditor lines={lines} taxes={taxes} onUpdateLine={updateLine} onAddLine={addLine} onRemoveLine={removeLine} />

      <Button title={submitting ? intl.formatMessage({ id: 'billForm.creating' }) : intl.formatMessage({ id: 'billForm.createBill' })} onPress={handleSubmit} loading={submitting} />
    </Screen>
  );
}
