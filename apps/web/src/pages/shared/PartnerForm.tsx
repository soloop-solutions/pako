import { useState, type FormEvent } from "react";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PartnerFormProps = {
  companyId: string;
  role: "customer" | "vendor";
  onCreated: () => void;
};

export function PartnerForm({ companyId, role, onCreated }: PartnerFormProps) {
  const [name, setName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.partners(companyId, {
        name: name.trim(),
        taxNumber: taxNumber.trim() || undefined,
        isCustomer: role === "customer",
        isVendor: role === "vendor",
      });
      setName("");
      setTaxNumber("");
      onCreated();
    } catch (err) {
      setError(getApiErrorMessage(err, `Could not create ${role}.`));
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`${role}-name`}>Name</Label>
          <Input id={`${role}-name`} required value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`${role}-tax-number`}>Tax number</Label>
          <Input id={`${role}-tax-number`} value={taxNumber} onChange={(event) => setTaxNumber(event.target.value)} />
        </div>
        <Button type="submit" disabled={submitting || name.trim().length === 0}>
          {submitting ? "Creating..." : role === "customer" ? "Add customer" : "Add vendor"}
        </Button>
      </div>
    </form>
  );
}
