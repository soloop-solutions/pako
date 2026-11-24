import { useId } from "react";
import { useIntl } from "react-intl";

import { Input } from "@/components/ui/input";

// Units offered for a document line that has no item (the list is a message, so it follows the
// language). The user may type any other unit; the server keeps it as typed (at most 32
// characters) and only prints it.
export function FreeUnitInput({ value, onChange, className = "h-7 text-xs" }: { value: string; onChange: (value: string) => void; className?: string }) {
  const intl = useIntl();
  const listId = useId();
  const commonUnits = intl.formatMessage({ id: "documentLine.commonUnits" }).split(",");
  return (
    <>
      <Input
        className={className}
        list={listId}
        maxLength={32}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={intl.formatMessage({ id: "documentLine.unitPlaceholder" })}
        aria-label={intl.formatMessage({ id: "items.lineUnit" })}
      />
      <datalist id={listId}>
        {commonUnits.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
    </>
  );
}
