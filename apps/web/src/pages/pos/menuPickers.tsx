// docs/POS_PLAN.md P3: item pickers shared by the menu setup and the recipe tab (see useItemLookup).
import { X } from "lucide-react";
import { useIntl } from "react-intl";

import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { ItemLookup as Lookup } from "@/hooks/useItemLookup";

export function ItemPicker({ lookup, value, onChange, exclude = [], label, id, placeholder, disabled }: {
  lookup: Lookup;
  value: string;
  onChange: (id: string) => void;
  exclude?: string[];
  label: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const intl = useIntl();
  const t = (key: string) => intl.formatMessage({ id: key });
  const current = lookup.find(value);
  const options = lookup.search.items.filter((i) => i.id === value || !exclude.includes(i.id)).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
  if (current && !options.some((o) => o.value === current.id)) options.unshift({ value: current.id, label: `${current.code} · ${current.name}` });
  return (
    <SearchableSelect
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={onChange}
      placeholder={placeholder ?? t("pos.setup3.pickItem")}
      searchPlaceholder={t("common.search")}
      noResultsText={t("common.noResults")}
      onSearchChange={lookup.search.onSearchChange}
      options={options}
    />
  );
}

export function ItemChips({ ids, lookup, onRemove }: { ids: string[]; lookup: Lookup; onRemove: (id: string) => void }) {
  const intl = useIntl();
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const name = lookup.find(id)?.name ?? "…";
        return (
          <Badge key={id} variant="secondary" className="gap-1">
            {name}
            <button type="button" aria-label={intl.formatMessage({ id: "pos.setup3.removeItem" }, { name })} onClick={() => onRemove(id)}>
              <X className="size-3" />
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
