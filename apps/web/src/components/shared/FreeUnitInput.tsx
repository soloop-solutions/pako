import { useId } from "react";
import { useIntl } from "react-intl";

import { Input } from "@/components/ui/input";

// Units offered for a document line that has no item. The user may type any other unit; the
// server keeps it as typed (at most 32 characters) and only prints it.
const COMMON_UNITS = ["copë", "kg", "g", "l", "m", "m²", "m³", "orë", "ditë", "pako", "kuti", "set"];

export function FreeUnitInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const intl = useIntl();
  const listId = useId();
  return (
    <>
      <Input
        className="h-7 text-xs"
        list={listId}
        maxLength={32}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={intl.formatMessage({ id: "documentLine.unitPlaceholder" })}
        aria-label={intl.formatMessage({ id: "items.lineUnit" })}
      />
      <datalist id={listId}>
        {COMMON_UNITS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
    </>
  );
}
