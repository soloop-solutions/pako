import type { IntlShape } from "react-intl";

import { accountPath, entityPath, itemPath, partnerPath } from "@/lib/entityLinks";
import { formatDisplayDate } from "@/lib/dates";

export const AUDIT_ENTITY_TYPES = [
  "Company",
  "Invoice",
  "Bill",
  "JournalEntry",
  "Journal",
  "Account",
  "AccountGroup",
  "Partner",
  "Item",
  "TaxDefinition",
  "CompanyAccountDefaults",
  "AccountLockException",
  "NumberSeries",
  "PaymentMethod",
  "CompanyBankAccount",
  "PayrollRun",
  "PayrollAdjustment",
  "Employee",
  "EmployeeContract",
  "EmployeeLoan",
  "Department",
  "StockDocument",
  "PurchaseOrder",
  "SalesOrder",
  "Reconciliation",
  "CostCenter",
  "Project",
  "Warehouse",
  "PriceList",
  "Membership",
  "CompanyRole",
] as const;

export const AUDIT_ACTIONS = [
  "Created",
  "Updated",
  "Deleted",
  "Post",
  "Payment",
  "Refund",
  "LockDateSet",
  "HardLockSet",
  "LockExceptionGranted",
  "LockExceptionRevoked",
] as const;

export function auditEntityTypeLabel(intl: IntlShape, entityType: string): string {
  const id = `audit.entity.${entityType}`;
  return id in intl.messages ? intl.formatMessage({ id }) : humanizeField(entityType);
}

export function auditActionLabel(intl: IntlShape, action: string): string {
  const id = `audit.action.${action}`;
  return id in intl.messages ? intl.formatMessage({ id }) : humanizeField(action);
}

export function auditEntityPath(entityType: string, entityId: string): string | null {
  if (entityType === "Account") return accountPath(entityId);
  if (entityType === "Partner") return partnerPath(entityId);
  if (entityType === "Item") return itemPath(entityId);
  return entityPath({ kind: entityType, id: entityId });
}

export function humanizeField(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .trim();
  if (!spaced) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase().replace(/\b(id|vat|nui|ip|iban|cit)\b/g, (m) => m.toUpperCase());
}

const MONEY_FIELD = /(amount|total|price|balance|debit|credit|cost|creditlimit|fee|salary|wage|gross|net)$/i;
const NUMBER = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function formatAuditValue(intl: IntlShape, field: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return intl.formatMessage({ id: "audit.detail.empty" });
  if (/^true$/i.test(value)) return intl.formatMessage({ id: "audit.detail.yes" });
  if (/^false$/i.test(value)) return intl.formatMessage({ id: "audit.detail.no" });
  if (ISO_DATE_TIME.test(value)) return formatAuditDateTime(value);
  if (ISO_DATE.test(value)) return formatDisplayDate(value);
  if (NUMBER.test(value) && MONEY_FIELD.test(field)) {
    return intl.formatNumber(Number(value), { style: "currency", currency: "EUR" });
  }
  return value;
}

export function formatAuditDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
