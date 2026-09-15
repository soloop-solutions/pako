import type { IntlShape } from "react-intl";

// B6: real now — backend/Pako.Domain/Companies/Item.cs's ItemType enum
// (Goods/Service/Normative — Normative is Kosovo/Albanian terminology for a recipe/BOM-costed
// goods line). ItemResponse.type is a required field on every item; these values match the real
// enum order exactly (confirmed against Item.cs directly). Was mocked in an earlier pass
// (src/mocks/itemTypesMockFlag.ts/itemTypesHandlers.ts, now deleted) before the real field landed.
export const ItemType = { Goods: 0, Service: 1, Normative: 2 } as const;

export const ITEM_TYPE_OPTION_KEYS = [
  { value: ItemType.Goods, labelKey: "items.form.typeGoods" },
  { value: ItemType.Service, labelKey: "items.form.typeService" },
  { value: ItemType.Normative, labelKey: "items.form.typeNormative" },
] as const;

export function itemTypeLabel(value: number | null | undefined, intl: IntlShape): string {
  const option = ITEM_TYPE_OPTION_KEYS.find((o) => o.value === value);
  return option ? intl.formatMessage({ id: option.labelKey }) : "—";
}
