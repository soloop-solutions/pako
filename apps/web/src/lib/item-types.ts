import type { IntlShape } from "react-intl";
import type { ItemResponse } from "@pako/shared";

// F5 (item register) — MOCKED, not a real backend field. The real `Item` entity
// (backend/Pako.Domain/Companies/Item.cs) has no type classification at all — see
// src/mocks/itemTypesMockFlag.ts / src/mocks/itemTypesHandlers.ts for how this is spliced onto the
// real ItemResponse while the Items screen is on screen. Purely descriptive for now — no stock or
// valuation logic in this release reads it (see docs/V2_PARALLEL_TRACKS.md).
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

// The real ItemResponse plus the mocked `type` field spliced in by itemTypesHandlers.ts's GET
// interceptors — `type` is absent (not just undefined) for any item that predates the mock or was
// never given one, hence the optional modifier rather than a required field with a default.
// itemTypesHandlers.ts's `withMockType` sets it via `getMockItemType(item.id) ?? null`, so the
// actual runtime value for an item with no mocked type is `null`, not `undefined` — both are
// handled identically by `itemTypeLabel` above, but the type should say so.
export interface ItemWithType extends ItemResponse {
  type?: number | null;
}
