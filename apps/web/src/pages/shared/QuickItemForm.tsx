import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

type QuickItemFormProps = {
  companyId: string;
  onCreated: (id: string) => void;
};

export function QuickItemForm({ companyId, onCreated }: QuickItemFormProps) {
  const intl = useIntl();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [defaultUnitPrice, setDefaultUnitPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiClient.itemsPOST(companyId, {
        name: name.trim(),
        unit: unit.trim() || "pcs",
        type: 0,
        defaultUnitPrice: defaultUnitPrice ? parseFloat(defaultUnitPrice) : undefined,
      });
      onCreated(result.id);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "quickItem.createError" })));
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
      <FormField label={intl.formatMessage({ id: "quickItem.name" })} htmlFor="quick-item-name" required>
        <Input id="quick-item-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={intl.formatMessage({ id: "quickItem.unit" })} htmlFor="quick-item-unit">
          <Input id="quick-item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs" />
        </FormField>
        <FormField label={intl.formatMessage({ id: "quickItem.defaultPrice" })} htmlFor="quick-item-price">
          <Input id="quick-item-price" type="number" step="0.01" min="0" value={defaultUnitPrice} onChange={(e) => setDefaultUnitPrice(e.target.value)} />
        </FormField>
      </div>
      <Button type="submit" disabled={submitting || name.trim().length === 0}>
        {submitting ? intl.formatMessage({ id: "common.saving" }) : intl.formatMessage({ id: "quickItem.create" })}
      </Button>
    </form>
  );
}
