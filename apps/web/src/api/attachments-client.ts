// Attachments on documents, through the real generic AttachmentsController
// (api/companies/{companyId}/attachments?ownerType=&ownerId=). The download stays a plain
// authorized fetch because the generated `download` method returns no body.

import { API_BASE_URL, apiClient, authorizedFetch, getApiErrorMessage } from "@/api/client";

export type AttachmentDocumentKind = "invoice" | "bill" | "stockDocument";

export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

// Pako.Domain.Attachments.AttachmentOwnerType: listed by number, uploaded by name.
const OWNER: Record<AttachmentDocumentKind, { value: number; name: string }> = {
  invoice: { value: 0, name: "Invoice" },
  bill: { value: 1, name: "Bill" },
  stockDocument: { value: 5, name: "StockDocument" },
};

// The server's message (or the app's translated one for a 403/404/500/network failure) when there
// is one. Otherwise the error carries no message and the panel shows its own translated fallback,
// so no English text is hard-coded here.
function failure(err: unknown): Error {
  return new Error(getApiErrorMessage(err, ""));
}

function toAttachment(a: { id: string; fileName: string; contentType: string; sizeBytes: number; uploadedAtUtc: string }): Attachment {
  return { id: a.id, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, uploadedAt: a.uploadedAtUtc };
}

export async function fetchAttachments(companyId: string, documentKind: AttachmentDocumentKind, documentId: string): Promise<Attachment[]> {
  try {
    return (await apiClient.attachmentsAll(companyId, OWNER[documentKind].value, documentId)).map(toAttachment);
  } catch (err) {
    throw failure(err);
  }
}

export async function uploadAttachment(
  companyId: string,
  documentKind: AttachmentDocumentKind,
  documentId: string,
  file: File,
): Promise<Attachment> {
  try {
    return toAttachment(await apiClient.attachmentsPOST(companyId, OWNER[documentKind].name, documentId, { data: file, fileName: file.name }));
  } catch (err) {
    throw failure(err);
  }
}

export async function deleteAttachment(
  companyId: string,
  _documentKind: AttachmentDocumentKind,
  _documentId: string,
  attachmentId: string,
): Promise<void> {
  try {
    await apiClient.attachmentsDELETE(companyId, attachmentId);
  } catch (err) {
    throw failure(err);
  }
}

export async function fetchAttachmentContent(
  companyId: string,
  _documentKind: AttachmentDocumentKind,
  _documentId: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/attachments/${attachmentId}/download`);
  if (!response.ok) throw new Error("");
  return response.blob();
}
