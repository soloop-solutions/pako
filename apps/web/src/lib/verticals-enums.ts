// docs/ERP_VERTICALS_PLAN.md (POS plan P8) — construction, real estate sales and property rental.
// Pako.Api doesn't emit enum member names, so these arrive as plain numbers. Order must match
// backend/Pako.Domain/Projects/Construction.cs and RealEstate.cs exactly, by hand.

export const SiteState = { Tender: 0, Active: 1, Completed: 2, Closed: 3 } as const;
export const SITE_STATES = [0, 1, 2, 3] as const;

export const ProgressBillState = { Draft: 0, Approved: 1, Invoiced: 2 } as const;

export const UnitKind = { Apartment: 0, Commercial: 1, Office: 2, Parking: 3, Storage: 4 } as const;
export const UNIT_KINDS = [0, 1, 2, 3, 4] as const;

export const UnitState = { Available: 0, Reserved: 1, Sold: 2, Compensation: 3, Rented: 4 } as const;
export const UNIT_STATES = [0, 1, 2, 3, 4] as const;

export const ReservationState = { Active: 0, Expired: 1, Converted: 2, Cancelled: 3 } as const;
export const RESERVATION_STATES = [0, 1, 2, 3] as const;

export const ContractKind = { Sale: 0, Compensation: 1 } as const;

export const ContractState = { Active: 0, Completed: 1, Cancelled: 2 } as const;
export const CONTRACT_STATES = [0, 1, 2] as const;

export const LeaseState = { Draft: 0, Active: 1, Ended: 2 } as const;
export const LEASE_STATES = [0, 1, 2] as const;

// The first day of a "YYYY-MM" month input, as the API's DateOnly month.
export const monthStart = (month: string) => (/^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month);
