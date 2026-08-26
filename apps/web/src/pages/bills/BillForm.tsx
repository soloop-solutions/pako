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

type BillFormProps = {
  companyId: string;
  vendors: PartnerResponse[];
  taxes: TaxDefinitionResponse[];
  onCreated: () => void;
};

export function BillForm({ companyId, vendors, taxes, onCreated }: BillFormProps) {
  const [partnerId, setPartnerId] = useState("");
  const [vendorReference, setVendorReference] = useState("");
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
      setError("Select a vendor.");
      return;
    }
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) {
      setError("Add at least one line.");
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.billsPOST(companyId, {
        partnerId,
        vendorReference: vendorReference.trim() || undefined,
        issueDate,
        dueDate,
        lines: validLines.map((line) => ({
          description: line.description,
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          taxDefinitionId: line.taxDefinitionId || undefined,
          expenseAccountId: undefined,
        })),
      });
      setPartnerId("");
      setVendorReference("");
      setLines([{ ...EMPTY_LINE }]);
      onCreated();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not create the bill."));
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

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-vendor">Vendor</Label>
          <Select id="bill-vendor" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
            <option value="">Select vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-vendor-reference">Vendor reference</Label>
          <Input
            id="bill-vendor-reference"
            value={vendorReference}
            onChange={(event) => setVendorReference(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-issue-date">Issue date</Label>
          <Input
            id="bill-issue-date"
            type="date"
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-due-date">Due date</Label>
          <Input id="bill-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
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
        {submitting ? "Creating..." : "Create bill"}
      </Button>
    </form>
  );
}
