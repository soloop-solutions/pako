import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PrescriptionResponse, SavePrescriptionRequest } from "@pako/shared";
import { Plus, X } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { usePosStores } from "@/hooks/usePos";
import { useItemSearch } from "@/hooks/useStock";
import { todayLocal } from "@/lib/pos-services";
import { ErrorAlert } from "@/pages/pos/hotel/hotel-shared";
import { Field } from "@/pages/pos/specialist/shared";
import { parseDecimal } from "@/pages/pos/specialist/specialist-utils";

interface LineDraft {
  key: string;
  itemId: string;
  quantity: string;
  dosage: string;
}

const NO_PAYER = "";

// docs/POS_PLAN.md §6.8 / P7: a prescription (recetë) as written — the prescriber, the patient, who
// pays part of it, and the medicines with quantities. Used at the till and on the pharmacy page;
// a prescription can be changed only while nothing has been dispensed from it (the API checks).
export function PrescriptionForm({ storeId: fixedStoreId, initial, onSaved, onCancel }: {
  /** The till's store; the pharmacy page lets the user pick one. */
  storeId?: string;
  initial?: PrescriptionResponse;
  onSaved: (prescription: PrescriptionResponse) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const stores = usePosStores().data ?? [];
  const payers = useQuery({
    queryKey: ["posPayers", companyId],
    queryFn: () => apiClient.listPosPayers(companyId),
    enabled: !!activeCompanyId,
  }).data ?? [];
  const itemSearch = useItemSearch();

  const [storeId, setStoreId] = useState(fixedStoreId ?? initial?.storeId ?? stores.find((s) => s.isActive)?.id ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [issuedOn, setIssuedOn] = useState(initial?.issuedOn?.slice(0, 10) ?? todayLocal());
  const [validUntil, setValidUntil] = useState(initial?.validUntil?.slice(0, 10) ?? "");
  const [prescriber, setPrescriber] = useState(initial?.prescriber ?? "");
  const [licence, setLicence] = useState(initial?.prescriberLicence ?? "");
  const [patient, setPatient] = useState(initial?.patientName ?? "");
  const [personalNumber, setPersonalNumber] = useState(initial?.patientPersonalNumber ?? "");
  const [payerId, setPayerId] = useState(initial?.payerId ?? NO_PAYER);
  const [coverage, setCoverage] = useState(initial?.payerId ? String(initial.coveragePercent) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((l) => ({ key: l.id, itemId: l.itemId, quantity: String(l.quantity), dosage: l.dosage ?? "" }))
      : [{ key: crypto.randomUUID(), itemId: "", quantity: "1", dosage: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const effectiveStore = fixedStoreId ?? storeId;
  const payer = payers.find((p) => p.id === payerId);

  // The saved lines' items may not be among the searched ones: name them from the prescription.
  const itemOptions = useMemo(() => {
    const options = itemSearch.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.activeIngredient ?? undefined }));
    for (const l of initial?.lines ?? [])
      if (!options.some((o) => o.value === l.itemId)) options.unshift({ value: l.itemId, label: l.itemName, description: undefined });
    return options;
  }, [itemSearch.items, initial?.lines]);

  const save = useMutation({
    mutationFn: (body: SavePrescriptionRequest) =>
      initial ? apiClient.updatePosPrescription(companyId, initial.id, body) : apiClient.createPosPrescription(companyId, body),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const filled = lines.filter((l) => l.itemId);
    if (filled.length === 0) {
      setError(t("spec.rx.linesRequired"));
      return;
    }
    const parsed = filled.map((l) => ({ ...l, value: parseDecimal(l.quantity, 3) }));
    if (parsed.some((l) => l.value == null || !(l.value > 0))) {
      setError(t("spec.rx.quantityInvalid"));
      return;
    }
    const coverageValue = coverage.trim() === "" ? undefined : parseDecimal(coverage, 2);
    if (payerId && coverage.trim() !== "" && (coverageValue == null || coverageValue > 100)) {
      setError(t("spec.rx.coverageInvalid"));
      return;
    }
    save.mutate({
      storeId: effectiveStore,
      number: number.trim(),
      issuedOn,
      prescriber: prescriber.trim(),
      patientName: patient.trim(),
      lines: parsed.map((l) => ({ itemId: l.itemId, quantity: l.value as number, ...(l.dosage.trim() ? { dosage: l.dosage.trim() } : {}) })),
      ...(validUntil ? { validUntil } : {}),
      ...(licence.trim() ? { prescriberLicence: licence.trim() } : {}),
      ...(personalNumber.trim() ? { patientPersonalNumber: personalNumber.trim() } : {}),
      ...(payerId ? { payerId } : {}),
      ...(payerId && coverageValue != null ? { coveragePercent: coverageValue } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} data-testid="prescription-form">
      <ErrorAlert message={error} />
      {!fixedStoreId && (
        <Field id="rx-store" label={t("spec.store")}>
          <Select id="rx-store" value={storeId} onValueChange={setStoreId} options={stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="rx-number" label={t("spec.rx.number")}>
          <Input id="rx-number" required maxLength={40} autoFocus value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field id="rx-issued" label={t("spec.rx.issuedOn")}>
          <Input id="rx-issued" type="date" required value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </Field>
        <Field id="rx-valid" label={t("spec.rx.validUntil")}>
          <Input id="rx-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
        <Field id="rx-prescriber" label={t("spec.rx.prescriber")}>
          <Input id="rx-prescriber" required maxLength={120} value={prescriber} onChange={(e) => setPrescriber(e.target.value)} />
        </Field>
        <Field id="rx-licence" label={t("spec.rx.licence")}>
          <Input id="rx-licence" maxLength={40} value={licence} onChange={(e) => setLicence(e.target.value)} />
        </Field>
        <div />
        <Field id="rx-patient" label={t("spec.rx.patient")}>
          <Input id="rx-patient" required maxLength={120} value={patient} onChange={(e) => setPatient(e.target.value)} />
        </Field>
        <Field id="rx-personal" label={t("spec.rx.personalNumber")}>
          <Input id="rx-personal" maxLength={20} value={personalNumber} onChange={(e) => setPersonalNumber(e.target.value)} className="tabular-nums" />
        </Field>
        <div />
        <Field id="rx-payer" label={t("spec.rx.payer")}>
          <Select
            id="rx-payer"
            value={payerId}
            onValueChange={setPayerId}
            options={[
              { value: NO_PAYER, label: t("spec.rx.payer.none") },
              ...payers.filter((p) => p.isActive || p.id === payerId).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </Field>
        <Field
          id="rx-coverage"
          label={t("spec.rx.coverage")}
          hint={payer ? t("spec.rx.coverage.hint", { percent: payer.coveragePercent }) : undefined}
        >
          <Input
            id="rx-coverage"
            inputMode="decimal"
            disabled={!payerId}
            placeholder={payer ? String(payer.coveragePercent) : ""}
            value={coverage}
            onChange={(e) => setCoverage(e.target.value)}
            className="text-right tabular-nums"
          />
        </Field>
        <Field id="rx-notes" label={t("spec.rx.notes")}>
          <Input id="rx-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-col gap-2 rounded-md border p-2">
        <div className="grid grid-cols-[1fr_6rem_10rem_auto] gap-2 text-xs font-medium text-muted-foreground">
          <span>{t("spec.rx.medicine")}</span>
          <span className="text-right">{t("common.quantity")}</span>
          <span>{t("spec.rx.dosage")}</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div key={l.key} className="grid grid-cols-[1fr_6rem_10rem_auto] items-center gap-2" data-testid="rx-line">
            <SearchableSelect
              id={`rx-item-${i}`}
              aria-label={t("spec.rx.medicine")}
              value={l.itemId}
              onChange={(v) => setLine(l.key, { itemId: v })}
              onSearchChange={itemSearch.onSearchChange}
              placeholder={t("spec.rx.medicine.pick")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              options={itemOptions}
            />
            <Input
              aria-label={t("common.quantity")}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLine(l.key, { quantity: e.target.value })}
              className="text-right tabular-nums"
            />
            <Input aria-label={t("spec.rx.dosage")} maxLength={200} value={l.dosage} onChange={(e) => setLine(l.key, { dosage: e.target.value })} />
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-label={t("common.remove")}
              disabled={lines.length === 1}
              onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => setLines((all) => [...all, { key: crypto.randomUUID(), itemId: "", quantity: "1", dosage: "" }])}
        >
          <Plus className="size-4" /> {t("spec.rx.addLine")}
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={save.isPending}>{t("common.cancel")}</Button>
        <Button type="submit" disabled={save.isPending || !effectiveStore || !number.trim() || !prescriber.trim() || !patient.trim()}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
