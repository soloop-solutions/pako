import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// A5 (v2 release): the entire editable surface of a Posted invoice/bill — due date and internal
// notes, nothing else. Deliberately not reusing InvoiceForm/BillForm's big line-editor grid,
// since only these two unrelated fields are ever in play here.
type EditPostedFieldsFormProps = {
  companyId: string;
  documentKind: "invoice" | "bill";
  documentId: string;
  initialDueDate: string;
  initialInternalNotes: string | undefined;
  onSaved: (dueDate: string, internalNotes: string | undefined) => void;
};

export function EditPostedFieldsForm({
  companyId,
  documentKind,
  documentId,
  initialDueDate,
  initialInternalNotes,
  onSaved,
}: EditPostedFieldsFormProps) {
  const intl = useIntl();
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [internalNotes, setInternalNotes] = useState(initialInternalNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = { dueDate, internalNotes: internalNotes.trim() || undefined };
      if (documentKind === "invoice") {
        await apiClient.invoicesPATCH(companyId, documentId, body);
      } else {
        await apiClient.billsPATCH(companyId, documentId, body);
      }
      onSaved(dueDate, internalNotes.trim() || undefined);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "editPostedFields.error" })));
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-posted-due-date">{intl.formatMessage({ id: "editPostedFields.dueDate" })}</Label>
          <Input id="edit-posted-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-posted-notes">{intl.formatMessage({ id: "editPostedFields.internalNotes" })}</Label>
          <Input id="edit-posted-notes" value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
        </div>
      </div>
      <Button type="submit" className="w-fit" disabled={submitting}>
        {submitting ? intl.formatMessage({ id: "editPostedFields.saving" }) : intl.formatMessage({ id: "editPostedFields.save" })}
      </Button>
    </form>
  );
}
