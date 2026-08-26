// Pako.Api's built-in Microsoft.AspNetCore.OpenApi doesn't emit enum member names, so the
// generated client types MembershipRole as plain `number`. Order must be kept in sync by hand
// with backend/Pako.Domain/Companies/MembershipRole.cs — see packages/shared/README.md.

const MEMBERSHIP_ROLE_LABELS = ["Firm Admin", "Firm Accountant", "Client Admin", "Client Viewer"] as const;

export const FIRM_ADMIN = 0;
export const FIRM_ACCOUNTANT = 1;
export const CLIENT_ADMIN = 2;
export const CLIENT_VIEWER = 3;

export function membershipRoleLabel(value: number): string {
  return MEMBERSHIP_ROLE_LABELS[value] ?? `Unknown (${value})`;
}

export function isCompanyAdminRole(value: number): boolean {
  return value === FIRM_ADMIN || value === CLIENT_ADMIN;
}

export function isFirmAdminRole(value: number): boolean {
  return value === FIRM_ADMIN;
}

export const companyMemberRoles = [
  { value: CLIENT_ADMIN, label: membershipRoleLabel(CLIENT_ADMIN) },
  { value: CLIENT_VIEWER, label: membershipRoleLabel(CLIENT_VIEWER) },
];

export const firmMemberRoles = [
  { value: FIRM_ADMIN, label: membershipRoleLabel(FIRM_ADMIN) },
  { value: FIRM_ACCOUNTANT, label: membershipRoleLabel(FIRM_ACCOUNTANT) },
];
