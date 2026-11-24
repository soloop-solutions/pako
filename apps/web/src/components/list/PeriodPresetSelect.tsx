import { useIntl } from "react-intl";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { datePresetRange, matchingDatePreset, type DatePresetId } from "@/lib/date-presets";

const REPORT_PRESETS: DatePresetId[] = ["thisMonth", "lastMonth", "thisQuarter", "lastQuarter", "thisYear", "lastYear"];

// UI/UX round 2026-11-24: one-click report periods (this/last month, quarter, year) beside the
// from/to fields; shows the preset the current range matches.
export function PeriodPresetSelect({ id, from, to, onChange }: { id: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const intl = useIntl();
  const active = matchingDatePreset(from, to);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{intl.formatMessage({ id: "reports.period" })}</Label>
      <Select
        id={id}
        className="w-40"
        value={active && REPORT_PRESETS.includes(active) ? active : ""}
        placeholder={intl.formatMessage({ id: "reports.period.custom" })}
        onValueChange={(value) => {
          if (!value) return;
          const [nextFrom, nextTo] = datePresetRange(value as DatePresetId);
          onChange(nextFrom, nextTo);
        }}
        options={REPORT_PRESETS.map((preset) => ({ value: preset, label: intl.formatMessage({ id: `listRibbon.preset.${preset}` }) }))}
      />
    </div>
  );
}
