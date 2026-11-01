import type { PosOrderLineRequest, TabLineResponse } from "@pako/shared";

import { HotelTabKind, TabLineState, tabKindKey } from "@/lib/pos-enums";

/** A line of a sale that pays (part of) a tab line: the server takes item, price and discount from the tab. */
export const tabPayLine = (tabLineId: string, quantity: number): PosOrderLineRequest => ({
  itemId: undefined, description: "", quantity, unitPrice: 0, taxDefinitionId: undefined, discountAmount: 0, tabLineId,
});

/** What is still to pay on a line: ordered (pending or sent) with some quantity left. */
export const payable = (l: TabLineResponse) => (l.state === TabLineState.Pending || l.state === TabLineState.Sent) && l.remaining > 0;

/** One payment of the tab, ready for the payment dialog. `key` names it for its ClientUuid. */
export interface TabPayment {
  key: string;
  lines: PosOrderLineRequest[];
  total: number;
  /** The equal-split part this pays. */
  part?: number;
}

/** The message key naming a tab's kind; a hotel folio (P5) and an event bill have their own. */
export const tabKindLabelKey = (kind: number) =>
  kind === HotelTabKind.Folio ? "hotel.tabKind.folio" : kind === HotelTabKind.Event ? "hotel.tabKind.event" : `rest.kind.${tabKindKey(kind)}`;

/** A restaurant, bar or takeaway tab (not a folio or an event bill) can be charged to a room. */
export const chargeableToRoom = (kind: number) => kind !== HotelTabKind.Folio && kind !== HotelTabKind.Event;
