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

function toAttachment(a: { id: string; fileName: string; contentType: string; sizeBytes: number; uploadedAtUtc: string }): Attachment {
  return { id: a.id, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, uploadedAt: a.uploadedAtUtc };
}

export async function fetchAttachments(companyId: string, documentKind: AttachmentDocumentKind, documentId: string): Promise<Attachment[]> {
  try {
    return (await apiClient.attachmentsAll(companyId, OWNER[documentKind].value, documentId)).map(toAttachment);
  } catch (err) {
    throw new Error(getApiErrorMessage(err, "Could not load attachments."));
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
    throw new Error(getApiErrorMessage(err, `Could not upload "${file.name}".`));
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
    throw new Error(getApiErrorMessage(err, "Could not delete this attachment."));
  }
}

export async function fetchAttachmentContent(
  companyId: string,
  _documentKind: AttachmentDocumentKind,
  _documentId: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/attachments/${attachmentId}/download`);
  if (!response.ok) throw new Error("Could not load this file.");
  return response.blob();
}
