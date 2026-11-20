import { API_BASE_URL, authorizedFetch, getApiErrorMessage } from "@/api/client";

export interface StockImportPreviewRow {
  rowNumber: number;
  status: string;
  name: string | null;
  unit: string | null;
  category: string | null;
  salePrice: number | null;
  revenueAccountCode: string | null;
  expenseAccountCode: string | null;
  inventoryAccountCode: string | null;
  vatCode: string | null;
  minimumStock: number | null;
  barcode: string | null;
  openingQty: number | null;
  openingUnitCost: number | null;
  purchaseUnit: string | null;
  purchaseFactor: number | null;
  salesUnit: string | null;
  salesFactor: number | null;
  description: string | null;
  errors: string[];
  warnings: string[];
}

export interface StockImportSummary {
  ready: number;
  warnings: number;
  errorCount: number;
}

export interface StockImportPreviewResponse {
  rows: StockImportPreviewRow[];
  summary: StockImportSummary;
  newCategories: string[];
}

export interface StockImportRowError {
  rowNumber: number;
  message: string;
}

export interface StockImportConfirmResponse {
  created: number;
  skipped: number;
  createdCategories: string[];
  openingDocumentId: string | null;
  openingDocumentNumber: string | null;
  errors: StockImportRowError[] | null;
}

function failure(err: unknown): Error {
  return new Error(getApiErrorMessage(err, ""));
}

function basePath(companyId: string): string {
  return `${API_BASE_URL}/api/companies/${companyId}/items/import`;
}

export async function downloadImportTemplate(companyId: string, filled: boolean): Promise<Blob> {
  const url = `${basePath(companyId)}/template?filled=${filled}`;
  const response = await authorizedFetch(url);
  if (!response.ok) throw failure(new Error(`HTTP ${response.status}`));
  return response.blob();
}

export async function previewStockImport(
  companyId: string,
  file: File,
  fallbackRevenueAccountId?: string,
  fallbackExpenseAccountId?: string,
  fallbackInventoryAccountId?: string,
): Promise<StockImportPreviewResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (fallbackRevenueAccountId) formData.append("fallbackRevenueAccountId", fallbackRevenueAccountId);
  if (fallbackExpenseAccountId) formData.append("fallbackExpenseAccountId", fallbackExpenseAccountId);
  if (fallbackInventoryAccountId) formData.append("fallbackInventoryAccountId", fallbackInventoryAccountId);

  const response = await authorizedFetch(`${basePath(companyId)}/preview`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw failure(new Error(text || `HTTP ${response.status}`));
  }
  return response.json() as Promise<StockImportPreviewResponse>;
}

export async function confirmStockImport(
  companyId: string,
  file: File,
  warehouseId: string,
  openingDate: string,
  fallbackRevenueAccountId?: string,
  fallbackExpenseAccountId?: string,
  fallbackInventoryAccountId?: string,
): Promise<StockImportConfirmResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("warehouseId", warehouseId);
  formData.append("openingDate", openingDate);
  if (fallbackRevenueAccountId) formData.append("fallbackRevenueAccountId", fallbackRevenueAccountId);
  if (fallbackExpenseAccountId) formData.append("fallbackExpenseAccountId", fallbackExpenseAccountId);
  if (fallbackInventoryAccountId) formData.append("fallbackInventoryAccountId", fallbackInventoryAccountId);

  const response = await authorizedFetch(`${basePath(companyId)}/confirm`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw failure(new Error(text || `HTTP ${response.status}`));
  }
  return response.json() as Promise<StockImportConfirmResponse>;
}
