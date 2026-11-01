// docs/POS_PLAN.md. Pako.Api doesn't emit enum member names, so these arrive as plain numbers.
// Order must match backend/Pako.Domain/Pos exactly, by hand.
// P7 appends Forecourt (fuel station) and SelfCheckout (kiosk lane).
export const RegisterProfile = { Retail: 0, Grocery: 1, Cafe: 2, Restaurant: 3, Services: 4, Forecourt: 5, SelfCheckout: 6 } as const;
export const REGISTER_PROFILES = [0, 1, 2, 3, 4, 5, 6] as const;
export const registerProfileKey = (p: number) =>
  ["retail", "grocery", "cafe", "restaurant", "services", "forecourt", "selfCheckout"][p] ?? "retail";

export const FiscalMode = { Training: 0, Sef: 1, Pef: 2 } as const;
export const fiscalModeKey = (m: number) => ["training", "sef", "pef"][m] ?? "training";

export const PosSessionState = { Open: 0, Closed: 1, Posted: 2 } as const;
export const posSessionStateKey = (s: number) => ["open", "closed", "posted"][s] ?? "open";

export const PosCashMovementKind = { FloatIn: 0, ToBank: 1, PettyIn: 2, PettyOut: 3, PaidOut: 4 } as const;
export const CASH_MOVEMENT_KINDS = [0, 1, 2, 3, 4] as const;
export const cashMovementKindKey = (k: number) => ["floatIn", "toBank", "pettyIn", "pettyOut", "paidOut"][k] ?? "paidOut";

export const PosOrderKind = { Sale: 0, Return: 1, Cancel: 2 } as const;
export const posOrderKindKey = (k: number) => ["sale", "return", "cancel"][k] ?? "sale";

export const FiscalDocumentType = { Sale: 1, Cancel: 2, Return: 3, Training: 9 } as const;
export const AtkStatus = { NotSent: 0, Pending: 1, Accepted: 2, Rejected: 3 } as const;
export const atkStatusKey = (s: number) => ["notSent", "pending", "accepted", "rejected"][s] ?? "notSent";

// Pako.Domain.Companies.PaymentMethodKind (append-only).
export const PaymentMethodKind = { Cash: 0, Bank: 1, Card: 2, Voucher: 3, GiftCard: 4, OnAccount: 5, Other: 6 } as const;

// Pako.Domain.Pos.BarcodeRuleKind (P2 in-store labels).
export const BarcodeRuleKind = { Weight: 0, Price: 1, Quantity: 2 } as const;
export const BARCODE_RULE_KINDS = [0, 1, 2] as const;
export const barcodeRuleKindKey = (k: number) => ["weight", "price", "quantity"][k] ?? "weight";

// Pako.Domain.Pos.ProgramKind / ProgramRewardKind / GiftCardKind (P2 promotions, coupons, loyalty).
export const ProgramKind = { Promotion: 0, Coupon: 1, Loyalty: 2 } as const;
export const PROGRAM_KINDS = [0, 1, 2] as const;
export const programKindKey = (k: number) => ["promotion", "coupon", "loyalty"][k] ?? "promotion";

export const ProgramRewardKind = { PercentOff: 0, AmountOff: 1, FixedPrice: 2, BuyXGetY: 3, MultiBuy: 4, BasketDiscount: 5 } as const;
export const PROGRAM_REWARD_KINDS = [0, 1, 2, 3, 4, 5] as const;
export const programRewardKey = (k: number) =>
  ["percentOff", "amountOff", "fixedPrice", "buyXGetY", "multiBuy", "basketDiscount"][k] ?? "percentOff";

export const GiftCardKind = { GiftCard: 0, StoreCredit: 1, Deposit: 2 } as const;
export const giftCardKindKey = (k: number) => ["giftCard", "storeCredit", "deposit"][k] ?? "giftCard";

// Pako.Domain.Pos.CustomerOrderKind / CustomerOrderState (P2 layaway and special orders).
export const CustomerOrderKind = { Layaway: 0, SpecialOrder: 1 } as const;
export const CUSTOMER_ORDER_KINDS = [0, 1] as const;
export const customerOrderKindKey = (k: number) => ["layaway", "specialOrder"][k] ?? "layaway";

export const CustomerOrderState = { Open: 0, Ready: 1, Collected: 2, Cancelled: 3 } as const;
export const CUSTOMER_ORDER_STATES = [0, 1, 2, 3] as const;
export const customerOrderStateKey = (s: number) => ["open", "ready", "collected", "cancelled"][s] ?? "open";

// Pako.Domain.Inventory.ItemSerialStatus (P2 serials and warranty).
export const ItemSerialStatus = { InStock: 0, Sold: 1, Returned: 2 } as const;
export const itemSerialStatusKey = (s: number) => ["inStock", "sold", "returned"][s] ?? "inStock";

// Pako.Api.Contracts.PosReportGroup (P2 store reporting).
export const PosReportGroup = { Day: 0, Hour: 1, Store: 2, Register: 3, Cashier: 4, Item: 5, Category: 6, Tender: 7, Program: 8 } as const;
export const POS_REPORT_GROUPS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export const posReportGroupKey = (g: number) =>
  ["day", "hour", "store", "register", "cashier", "item", "category", "tender", "program"][g] ?? "day";

// Pako.Domain.Pos hospitality (P3): tabs, their lines, tables and kitchen tickets.
export const TabKind = { DineIn: 0, Takeaway: 1, Delivery: 2 } as const;
export const tabKindKey = (k: number) => ["dineIn", "takeaway", "delivery"][k] ?? "dineIn";

export const TabState = { Open: 0, PreBilled: 1, Closed: 2, Cancelled: 3 } as const;
export const tabStateKey = (s: number) => ["open", "preBilled", "closed", "cancelled"][s] ?? "open";

export const TabLineState = { Pending: 0, Sent: 1, Voided: 2, Requested: 3 } as const;
export const tabLineStateKey = (s: number) => ["pending", "sent", "voided", "requested"][s] ?? "pending";

export const TableShape = { Square: 0, Round: 1, Rectangle: 2 } as const;

export const KitchenTicketState = { New: 0, InProgress: 1, Ready: 2, Done: 3 } as const;
export const kitchenTicketStateKey = (s: number) => ["new", "inProgress", "ready", "done"][s] ?? "new";

export const ProductionCenterKind = { Kitchen: 0, Bar: 1, Grill: 2, Pizza: 3, Dessert: 4, Other: 5 } as const;

// P3 back office (floors designer, menu setup): option lists and message-key helpers.
export const TABLE_SHAPES = [0, 1, 2] as const;
export const tableShapeKey = (s: number) => ["square", "round", "rectangle"][s] ?? "square";
export const PRODUCTION_CENTER_KINDS = [0, 1, 2, 3, 4, 5] as const;
export const productionCenterKindKey = (k: number) => ["kitchen", "bar", "grill", "pizza", "dessert", "other"][k] ?? "other";

// Pako.Domain.Pos hotel and venues (P5). A hotel folio and an event bill are tabs of these kinds
// (TabKind continues: DineIn 0, Takeaway 1, Delivery 2, Folio 3, Event 4).
export const HotelTabKind = { Folio: 3, Event: 4 } as const;

export const RoomState = { Clean: 0, Dirty: 1, OutOfService: 2 } as const;
export const ROOM_STATES = [0, 1, 2] as const;
export const roomStateKey = (s: number) => ["clean", "dirty", "outOfService"][s] ?? "clean";

export const HotelBookingState = { Reserved: 0, CheckedIn: 1, CheckedOut: 2, Cancelled: 3, NoShow: 4 } as const;
export const hotelBookingStateKey = (s: number) => ["reserved", "checkedIn", "checkedOut", "cancelled", "noShow"][s] ?? "reserved";

export const EventBookingState = { Tentative: 0, Confirmed: 1, Completed: 2, Cancelled: 3 } as const;
export const eventBookingStateKey = (s: number) => ["tentative", "confirmed", "completed", "cancelled"][s] ?? "tentative";

export const TicketState = { Valid: 0, Used: 1, Cancelled: 2 } as const;
export const ticketStateKey = (s: number) => ["valid", "used", "cancelled"][s] ?? "valid";

// Pako.Domain.Pos specialist retail (P7): pharmacy prescriptions and online channels.
export const PrescriptionState = { Open: 0, PartlyDispensed: 1, Dispensed: 2, Cancelled: 3 } as const;
export const PRESCRIPTION_STATES = [0, 1, 2, 3] as const;
export const prescriptionStateKey = (s: number) => ["open", "partlyDispensed", "dispensed", "cancelled"][s] ?? "open";

export const SalesChannelKind = { Webshop: 0, Marketplace: 1, SocialMedia: 2 } as const;
export const SALES_CHANNEL_KINDS = [0, 1, 2] as const;
export const salesChannelKindKey = (k: number) => ["webshop", "marketplace", "socialMedia"][k] ?? "webshop";

export const ChannelOrderState = { New: 0, Accepted: 1, Ready: 2, Dispatched: 3, Completed: 4, Returned: 5, Cancelled: 6 } as const;
export const CHANNEL_ORDER_STATES = [0, 1, 2, 3, 4, 5, 6] as const;
export const channelOrderStateKey = (s: number) =>
  ["new", "accepted", "ready", "dispatched", "completed", "returned", "cancelled"][s] ?? "new";

export const ChannelFulfilment = { Pickup: 0, Delivery: 1 } as const;
export const channelFulfilmentKey = (f: number) => ["pickup", "delivery"][f] ?? "pickup";

export const ChannelPayment = { Prepaid: 0, CashOnDelivery: 1, AtPickup: 2 } as const;
export const channelPaymentKey = (p: number) => ["prepaid", "cashOnDelivery", "atPickup"][p] ?? "prepaid";
