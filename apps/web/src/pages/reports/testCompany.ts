import { vi } from "vitest";
import type { CompanyResponse } from "@pako/shared";

export const testCompany = {
  id: "c1",
  name: "Test Co",
  accountingLockDate: "2026-08-31",
  taxLockDate: undefined,
  isArchived: false,
} as CompanyResponse;

export const companyContextMock: { useCompany: () => Record<string, unknown> } = {
  useCompany: () => ({
    companies: [testCompany],
    activeCompanyId: testCompany.id,
    activeCompany: testCompany,
    loading: false,
    error: null,
    setActiveCompanyId: vi.fn(),
    createCompany: vi.fn(),
    refresh: vi.fn(),
  }),
};
