// PROVISIONAL — F11 attachments. No generated client method exists (no AttachmentsController on
// the real backend at all — see src/mocks/attachmentsHandlers.ts) so this is a small hand-written
// wrapper unblocking AttachmentsPanel.tsx against that mock, same pattern as
// src/api/cost-centers-client.ts / src/api/partners-client.ts.
//
// Delete this file once the backend lands a real AttachmentsController and
// `pnpm generate:api-client` produces real methods for it — replace the call site
// (AttachmentsPanel.tsx) with the generated `apiClient.*` equivalents.

import { API_BASE_URL, authorizedFetch } from "@/api/client";

export type AttachmentDocumentKind = "invoice" | "bill";

export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

function basePath(companyId: string, documentKind: AttachmentDocumentKind, documentId: string): string {
  const segment = documentKind === "invoice" ? "invoices" : "bills";
  return `${API_BASE_URL}/api/companies/${companyId}/${segment}/${documentId}/attachments`;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string" && parsed) return parsed;
  } catch {
    return text;
  }
  return fallback;
}

export async function fetchAttachments(companyId: string, documentKind: AttachmentDocumentKind, documentId: string): Promise<Attachment[]> {
  const response = await authorizedFetch(basePath(companyId, documentKind, documentId));
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Could not load attachments (status ${response.status}).`));
  }
  return (await response.json()) as Attachment[];
}

export async function uploadAttachment(
  companyId: string,
  documentKind: AttachmentDocumentKind,
  documentId: string,
  file: File,
): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);
  // Sent as a separate plain field, not relied on from the multipart part's own filename — some
  // fetch/FormData implementations don't reliably round-trip a Blob part's filename (confirmed
  // while building this mock's test coverage: Node's undici-backed fetch, used by vitest's jsdom
  // environment, silently drops it to "blob"). A real backend accepting multipart uploads should
  // still prefer the Content-Disposition filename when present; this field is the reliable
  // fallback both this mock and, eventually, a browser-only path can count on.
  formData.append("fileName", file.name);
  const response = await authorizedFetch(basePath(companyId, documentKind, documentId), { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Could not upload "${file.name}".`));
  }
  return (await response.json()) as Attachment;
}

export async function deleteAttachment(
  companyId: string,
  documentKind: AttachmentDocumentKind,
  documentId: string,
  attachmentId: string,
): Promise<void> {
  const response = await authorizedFetch(`${basePath(companyId, documentKind, documentId)}/${attachmentId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Could not delete this attachment."));
  }
}

export async function fetchAttachmentContent(
  companyId: string,
  documentKind: AttachmentDocumentKind,
  documentId: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await authorizedFetch(`${basePath(companyId, documentKind, documentId)}/${attachmentId}/content`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Could not load this file."));
  }
  return response.blob();
}
