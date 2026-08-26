import { useState, type FormEvent } from "react";
import type { PartnerResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { taxRatePercentLabel } from "@/lib/tax-enums";

type Line = { description: string; quantity: string; unitPrice: string; taxDefinitionId: string };

const EMPTY_LINE: Line = { description: "", quantity: "1", unitPrice: "", taxDefinitionId: "" };

function today() {
  return new Date().toISOString().slice(0, 10);
}

type InvoiceFormProps = {
  companyId: string;
  customers: PartnerResponse[];
  taxes: TaxDefinitionResponse[];
  onCreated: () => void;
};

export function InvoiceForm({ companyId, customers, taxes, onCreated }: InvoiceFormProps) {
  const [partnerId, setPartnerId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!partnerId) {
      setError("Select a customer.");
      return;
    }
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) {
      setError("Add at least one line.");
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
      setPartnerId("");
      setLines([{ ...EMPTY_LINE }]);
      onCreated();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not create the invoice."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-customer">Customer</Label>
          <Select id="invoice-customer" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
            <option value="">Select customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-issue-date">Issue date</Label>
          <Input
            id="invoice-issue-date"
            type="date"
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-due-date">Due date</Label>
          <Input
            id="invoice-due-date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[2fr_5rem_6rem_1fr_auto] items-end gap-2">
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>Description</Label>}
              <Input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>Qty</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>Unit price</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>Tax</Label>}
              <Select
                value={line.taxDefinitionId}
                onChange={(event) => updateLine(index, { taxDefinitionId: event.target.value })}
              >
                <option value="">No tax</option>
                {taxes.map((tax) => (
                  <option key={tax.id} value={tax.id}>
                    {taxRatePercentLabel(tax)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)} disabled={lines.length <= 1}>
              Remove
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addLine}>
          Add line
        </Button>
      </div>

      <Button type="submit" className="w-fit" disabled={submitting}>
        {submitting ? "Creating..." : "Create invoice"}
      </Button>
    </form>
  );
}
