import { useState, type FormEvent } from "react";
import type { AccountResponse, JournalResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Line = { accountId: string; debit: string; credit: string; description: string };

const EMPTY_LINE: Line = { accountId: "", debit: "", credit: "", description: "" };

type JournalEntryFormProps = {
  companyId: string;
  journals: JournalResponse[];
  accounts: AccountResponse[];
  onCreated: () => void;
};

export function JournalEntryForm({ companyId, journals, accounts, onCreated }: JournalEntryFormProps) {
  const [journalId, setJournalId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveJournalId = journalId || journals.find((j) => j.code === "GEN")?.id || journals[0]?.id || "";

  const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit) || 0), 0);

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

    const validLines = lines.filter((line) => line.accountId);
    if (validLines.length < 2) {
      setError("Add at least two lines.");
      return;
    }
    if (!effectiveJournalId) {
      setError("No journal available for this company.");
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.journalEntries(companyId, {
        journalId: effectiveJournalId,
        date,
        reference: reference || undefined,
        lines: validLines.map((line) => ({
          accountId: line.accountId,
          partnerId: undefined,
          debit: parseFloat(line.debit) || 0,
          credit: parseFloat(line.credit) || 0,
          description: line.description || undefined,
        })),
      });
      setReference("");
      setLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
      onCreated();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not save the journal entry."));
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
          <Label htmlFor="journal">Journal</Label>
          <Select id="journal" value={effectiveJournalId} onChange={(event) => setJournalId(event.target.value)}>
            {journals.map((journal) => (
              <option key={journal.id} value={journal.id}>
                {journal.name} ({journal.code})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="date">Date</Label>
          <Input id="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reference">Reference</Label>
          <Input id="reference" value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[1fr_7rem_7rem_1fr_auto] items-end gap-2">
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>Account</Label>}
              <Select value={line.accountId} onChange={(event) => updateLine(index, { accountId: event.target.value })}>
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>Debit</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.debit}
                onChange={(event) => updateLine(index, { debit: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>Credit</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.credit}
                onChange={(event) => updateLine(index, { credit: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>Description</Label>}
              <Input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)} disabled={lines.length <= 2}>
              Remove
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addLine}>
          Add line
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Total debit: {totalDebit.toFixed(2)} - Total credit: {totalCredit.toFixed(2)}
        {totalDebit !== totalCredit && <span className="text-destructive"> (unbalanced - posting will be rejected)</span>}
      </p>

      <Button type="submit" className="w-fit" disabled={submitting}>
        {submitting ? "Saving..." : "Save as draft"}
      </Button>
    </form>
  );
}
