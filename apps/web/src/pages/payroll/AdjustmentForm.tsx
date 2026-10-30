import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { PayrollAdjustmentResponse, SavePayrollAdjustmentRequest } from "@pako/shared";

import { EmployeePicker } from "@/components/EmployeePicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  defaultRateMultiplier,
  isHourBasedKind,
  PAYROLL_ADJUSTMENT_KINDS,
  PayrollAdjustmentKind,
  payrollAdjustmentKindLabel,
} from "@/lib/payroll-enums";

type AdjustmentFormProps = {
  companyId: string;
  // First day of the selected month — the API normalises any date in the month anyway.
  period: string;
  initial?: PayrollAdjustmentResponse | null;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (request: SavePayrollAdjustmentRequest) => void;
  onCancel?: () => void;
};

function toInput(value: number | undefined | null): string {
  return value === undefined || value === null ? "" : String(value);
}

// Add/edit form for one bonus, allowance, hour-based premium or deduction. Hour-based kinds send
// hours (+ an optional multiplier); the API turns them into an amount from the employee's hourly
// rate. Every other kind sends the amount as typed.
export function AdjustmentForm({ companyId, period, initial, submitting = false, error, onSubmit, onCancel }: AdjustmentFormProps) {
  const intl = useIntl();
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? "");
  const [kind, setKind] = useState<number>(initial?.kind ?? PayrollAdjustmentKind.Bonus);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial && !isHourBasedKind(initial.kind) ? toInput(initial.amount) : "");
  const [hours, setHours] = useState(toInput(initial?.hours));
  const [multiplier, setMultiplier] = useState(toInput(initial?.rateMultiplier));
  const [localError, setLocalError] = useState<string | null>(null);

  const hourBased = isHourBasedKind(kind);
  const idPrefix = initial ? `adjustment-${initial.id}` : "adjustment-new";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (!employeeId) {
      setLocalError(intl.formatMessage({ id: "payroll.adjustment.employeeRequired" }));
      return;
    }
    const parsedHours = hours.trim() === "" ? undefined : Number(hours);
    const parsedMultiplier = multiplier.trim() === "" ? undefined : Number(multiplier);
    const parsedAmount = amount.trim() === "" ? undefined : Number(amount);

    if (hourBased) {
      if (parsedHours === undefined || !Number.isFinite(parsedHours) || parsedHours <= 0) {
        setLocalError(intl.formatMessage({ id: "payroll.adjustment.hoursRequired" }));
        return;
      }
      if (parsedMultiplier !== undefined && (!Number.isFinite(parsedMultiplier) || parsedMultiplier <= 0)) {
        setLocalError(intl.formatMessage({ id: "payroll.adjustment.multiplierInvalid" }));
        return;
      }
    } else if (parsedAmount === undefined || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setLocalError(intl.formatMessage({ id: "payroll.adjustment.amountRequired" }));
      return;
    }

    onSubmit({
      employeeId,
      period,
      kind,
      description: description.trim() || undefined,
      amount: hourBased ? undefined : parsedAmount,
      hours: hourBased ? parsedHours : undefined,
      rateMultiplier: hourBased ? parsedMultiplier : undefined,
    });
  }

  const shownError = localError ?? error ?? null;
  const defaultMultiplier = defaultRateMultiplier(kind);

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit} aria-label={intl.formatMessage({ id: "payroll.adjustment.formLabel" })}>
      {shownError && (
        <Alert variant="destructive">
          <AlertDescription>{shownError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor={`${idPrefix}-employee`}>{intl.formatMessage({ id: "payroll.adjustment.employee" })}</Label>
          <EmployeePicker
            id={`${idPrefix}-employee`}
            companyId={companyId}
            value={employeeId}
            selectedName={initial && employeeId === initial.employeeId ? initial.employeeName : undefined}
            onChange={(id) => setEmployeeId(id)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-kind`}>{intl.formatMessage({ id: "payroll.adjustment.kind" })}</Label>
          <Select
            id={`${idPrefix}-kind`}
            value={String(kind)}
            onValueChange={(v) => setKind(Number(v))}
            options={PAYROLL_ADJUSTMENT_KINDS.map((value) => ({
              value: String(value),
              label: payrollAdjustmentKindLabel(value, intl),
            }))}
          />
        </div>
        {hourBased ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-hours`}>{intl.formatMessage({ id: "payroll.adjustment.hours" })}</Label>
              <Input
                id={`${idPrefix}-hours`}
                type="number"
                step="0.25"
                min="0"
                className="text-right tabular-nums"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-multiplier`}>{intl.formatMessage({ id: "payroll.adjustment.multiplier" })}</Label>
              <Input
                id={`${idPrefix}-multiplier`}
                type="number"
                step="0.01"
                min="0"
                className="text-right tabular-nums"
                placeholder={defaultMultiplier !== undefined ? String(defaultMultiplier) : undefined}
                value={multiplier}
                onChange={(event) => setMultiplier(event.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <Label htmlFor={`${idPrefix}-amount`}>{intl.formatMessage({ id: "payroll.adjustment.amount" })}</Label>
            <Input
              id={`${idPrefix}-amount`}
              type="number"
              step="0.01"
              min="0"
              className="text-right tabular-nums"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-6">
          <Label htmlFor={`${idPrefix}-description`}>{intl.formatMessage({ id: "payroll.adjustment.description" })}</Label>
          <Input id={`${idPrefix}-description`} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </div>
      {hourBased && (
        <p className="text-xs text-muted-foreground">
          {intl.formatMessage({ id: "payroll.adjustment.hourBasedHint" }, { multiplier: defaultMultiplier ?? 1 })}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting
            ? intl.formatMessage({ id: "payroll.adjustment.saving" })
            : intl.formatMessage({ id: initial ? "payroll.adjustment.save" : "payroll.adjustment.add" })}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={submitting}>
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
        )}
      </div>
    </form>
  );
}
