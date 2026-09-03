// Pako.Api's built-in Microsoft.AspNetCore.OpenApi doesn't emit enum member names, so the
// generated client types MembershipRole as plain `number`. Order must be kept in sync by hand
// with backend/Pako.Domain/Companies/MembershipRole.cs — see packages/shared/README.md.

import type { IntlShape } from "react-intl";

const MEMBERSHIP_ROLE_KEYS = [
  "enum.membershipRole.firmAdmin",
  "enum.membershipRole.firmAccountant",
  "enum.membershipRole.clientAdmin",
  "enum.membershipRole.clientViewer",
] as const;

export const FIRM_ADMIN = 0;
export const FIRM_ACCOUNTANT = 1;
export const CLIENT_ADMIN = 2;
export const CLIENT_VIEWER = 3;

export function membershipRoleLabel(value: number, intl: IntlShape): string {
  const key = MEMBERSHIP_ROLE_KEYS[value];
  return key ? intl.formatMessage({ id: key }) : `Unknown (${value})`;
}

export function isCompanyAdminRole(value: number): boolean {
  return value === FIRM_ADMIN || value === CLIENT_ADMIN;
}

export function isFirmAdminRole(value: number): boolean {
  return value === FIRM_ADMIN;
}

export const companyMemberRoleValues = [CLIENT_ADMIN, CLIENT_VIEWER];
export const firmMemberRoleValues = [FIRM_ADMIN, FIRM_ACCOUNTANT];
