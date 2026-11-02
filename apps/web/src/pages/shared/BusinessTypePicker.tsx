import { useIntl } from "react-intl";

import { BUSINESS_TYPES, businessTypeKey } from "@/lib/business-types";
import { cn } from "@/lib/utils";

/**
 * The business types as a compact radio list, each with a line on what it switches on. Used by
 * the new-company dialog and Settings → Business type.
 */
export function BusinessTypePicker({
  name,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  value: number;
  onChange: (type: number) => void;
  disabled?: boolean;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <div role="radiogroup" aria-label={t("company.businessType")} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {BUSINESS_TYPES.map((type) => {
        const key = businessTypeKey(type);
        const checked = value === type;
        return (
          <label
            key={type}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2",
              checked ? "border-primary bg-primary/5" : "hover:bg-accent",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              className="mt-1"
              name={name}
              value={type}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(type)}
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{t(`company.businessType.${key}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`company.businessType.${key}.description`)}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
