import type { CostCodeResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useProjects } from "@/hooks/useVerticals";

// docs/ERP_VERTICALS_PLAN.md §1 — the bill form's project (a construction site, building or any
// ledger project) and, for a construction site's project, the cost code of each line.
export function BillProjectField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const intl = useIntl();
  const projects = (useProjects().data ?? []).filter((p) => p.isActive || p.id === value);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{intl.formatMessage({ id: "vx.billForm.project" })}</Label>
      <SearchableSelect
        id={id}
        value={value}
        onChange={onChange}
        placeholder={intl.formatMessage({ id: "vx.billForm.noProject" })}
        emptyOptionLabel={intl.formatMessage({ id: "vx.billForm.noProject" })}
        searchPlaceholder={intl.formatMessage({ id: "common.search" })}
        noResultsText={intl.formatMessage({ id: "common.noResults" })}
        options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
      />
    </div>
  );
}

export function CostCodeSelect({ costCodes, value, onChange }: { costCodes: CostCodeResponse[]; value: string; onChange: (value: string) => void }) {
  const intl = useIntl();
  return (
    <Select
      className="h-7 w-full text-xs"
      value={value}
      onValueChange={onChange}
      aria-label={intl.formatMessage({ id: "vx.billForm.costCode" })}
      placeholder={intl.formatMessage({ id: "vx.billForm.costCode" })}
      options={[
        { value: "", label: intl.formatMessage({ id: "vx.billForm.noCostCode" }) },
        ...costCodes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
      ]}
    />
  );
}
