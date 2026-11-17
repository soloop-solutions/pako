// Accounting Documents — a file cabinet for source documents organized by year/month/type.
// Manual API client following the same pattern as attachments-client.ts, using authorizedFetch
// for blob downloads and the generated apiClient where JSON responses suffice.

import { API_BASE_URL, authorizedFetch, getApiErrorMessage } from "@/api/client";

export type AccountingDocumentType = "Buy" | "Sell";

export interface AccountingDocument {
  id: string;
  fileName: string;
  uploadedAt: string;
}

export interface AccountingDocumentListResponse {
  items: AccountingDocument[];
  total: number;
}

function failure(err: unknown): Error {
  return new Error(getApiErrorMessage(err, ""));
}

function basePath(companyId: string): string {
  return `${API_BASE_URL}/api/companies/${companyId}/accounting-documents`;
}

export async function fetchAccountingDocuments(
  companyId: string,
  year: number,
  month: number,
  documentType: AccountingDocumentType,
): Promise<AccountingDocumentListResponse> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    documentType,
  });
  const response = await authorizedFetch(`${basePath(companyId)}?${params}`);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw failure(new Error(text || `HTTP ${response.status}`));
  }
  return response.json() as Promise<AccountingDocumentListResponse>;
}

export async function uploadAccountingDocument(
  companyId: string,
  year: number,
  month: number,
  documentType: AccountingDocumentType,
  file: File,
): Promise<AccountingDocument> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("year", String(year));
  formData.append("month", String(month));
  formData.append("documentType", documentType);

  const response = await authorizedFetch(`${basePath(companyId)}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw failure(new Error(text || `HTTP ${response.status}`));
  }
  return response.json() as Promise<AccountingDocument>;
}

export async function downloadAccountingDocument(
  companyId: string,
  documentId: string,
): Promise<Blob> {
  const response = await authorizedFetch(`${basePath(companyId)}/${documentId}/download`);
  if (!response.ok) throw failure(new Error(""));
  return response.blob();
}

export async function deleteAccountingDocument(
  companyId: string,
  documentId: string,
): Promise<void> {
  const response = await authorizedFetch(`${basePath(companyId)}/${documentId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw failure(new Error(text || `HTTP ${response.status}`));
  }
}
