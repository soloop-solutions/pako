// HR module enums. Like membership-enums.ts: Pako.Api's OpenAPI doesn't emit enum member names, so
// the generated client types these as plain `number`. Order must match the backend enums by hand
// (AccessLevel, PartnerScope, EmploymentType in Pako.Domain).

import type { IntlShape } from "react-intl";

export const AccessLevel = { None: 0, Read: 1, Write: 2 } as const;
export type AccessLevelValue = (typeof AccessLevel)[keyof typeof AccessLevel];

export const PartnerScope = { All: 0, Assigned: 1 } as const;

export const EmploymentType = { FullTime: 0, PartTime: 1, FixedTerm: 2 } as const;

const ACCESS_LEVEL_KEYS = ["hr.accessLevel.none", "hr.accessLevel.read", "hr.accessLevel.write"] as const;
const PARTNER_SCOPE_KEYS = ["hr.partnerScope.all", "hr.partnerScope.assigned"] as const;
const EMPLOYMENT_TYPE_KEYS = ["hr.employmentType.fullTime", "hr.employmentType.partTime", "hr.employmentType.fixedTerm"] as const;

export const accessLevelValues = [AccessLevel.None, AccessLevel.Read, AccessLevel.Write];
export const partnerScopeValues = [PartnerScope.All, PartnerScope.Assigned];
export const employmentTypeValues = [EmploymentType.FullTime, EmploymentType.PartTime, EmploymentType.FixedTerm];

function label(keys: readonly string[], value: number, intl: IntlShape): string {
  const key = keys[value];
  return key ? intl.formatMessage({ id: key }) : `Unknown (${value})`;
}

export function accessLevelLabel(value: number, intl: IntlShape): string {
  return label(ACCESS_LEVEL_KEYS, value, intl);
}

export function partnerScopeLabel(value: number, intl: IntlShape): string {
  return label(PARTNER_SCOPE_KEYS, value, intl);
}

export function employmentTypeLabel(value: number, intl: IntlShape): string {
  return label(EMPLOYMENT_TYPE_KEYS, value, intl);
}

/** Department permission modules, in matrix order. Keys match DepartmentPermissions / ModuleAccessResponse. */
export const permissionModules = ["sales", "purchases", "partners", "accounting", "reports", "hr"] as const;
export type PermissionModule = (typeof permissionModules)[number];

export function permissionModuleLabel(module: PermissionModule, intl: IntlShape): string {
  return intl.formatMessage({ id: `hr.module.${module}` });
}

/** Employee warning codes the API returns on EmployeeDetailResponse.warnings. */
const WARNING_KEYS: Record<string, string> = {
  BelowMinimumWage: "hr.warning.belowMinimumWage",
  MissingPersonalNumber: "hr.warning.missingPersonalNumber",
  MissingIban: "hr.warning.missingIban",
};

export function employeeWarningLabel(code: string, intl: IntlShape): string {
  const key = WARNING_KEYS[code];
  return key ? intl.formatMessage({ id: key }) : code;
}
