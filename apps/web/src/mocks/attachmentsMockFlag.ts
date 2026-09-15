// PROVISIONAL — see src/mocks/attachmentsHandlers.ts for why this exists and how to remove it.
//
// F11 (attachments). Confirmed by reading the real backend directly (grep for `IFormFile` across
// `backend/` returns nothing, no attachments table/entity/controller exists) — there is zero real
// backend counterpart, closer to F9's cost-center mock (fully invented) than to F6's partner mock
// (a splice onto a real GET). See attachmentsHandlers.ts's header for the full invented contract.
//
// Own tiny `msw`-free module, same discipline as accountsMockFlag.ts/costCentersMockFlag.ts:
// AttachmentsPanel.tsx needs to flip `setAttachmentsMockActive` SYNCHRONOUSLY on mount/unmount (no
// async round trip to race), so it's imported statically and kept separate from
// attachmentsHandlers.ts (which imports `msw`) so the static import only costs a few bytes.
//
// The uploaded-file STORE lives here too, not in attachmentsHandlers.ts — same reason
// costCentersMockFlag.ts holds its line->cost-center map rather than costCentersHandlers.ts: it's
// plain data (Blob/File are native Web APIs, no msw dependency), and keeping it here means the
// store's lifetime is decoupled from the `mockActive` boolean. That decoupling is the actual
// point: `mockActive` flips false every time AttachmentsPanel.tsx unmounts (leaving an invoice/bill
// detail page), but `store` is a plain module-level Map that is NEVER cleared on unmount — only
// `resetAttachmentsMock()` (called from src/test/setup.ts's global afterEach, between tests) clears
// it. That's what makes an uploaded attachment survive navigating away from a document's detail
// page and back to it within the same session — the exact behavior this task asked for, verified
// by AttachmentsPanel.test.tsx's own unmount/remount test.
//
// Keyed by companyId + document kind + document id, not by attachment id alone, since two
// different documents must never see each other's attachments.

export type AttachmentDocumentKind = "invoice" | "bill";

export interface MockAttachmentRecord {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  blob: Blob;
}

let mockActive = false;

export function setAttachmentsMockActive(active: boolean): void {
  mockActive = active;
}

export function isAttachmentsMockActive(): boolean {
  return mockActive;
}

const store = new Map<string, MockAttachmentRecord[]>();

function scopeKey(companyId: string, documentKind: AttachmentDocumentKind, documentId: string): string {
  return `${companyId}:${documentKind}:${documentId}`;
}

export function listMockAttachments(companyId: string, documentKind: AttachmentDocumentKind, documentId: string): MockAttachmentRecord[] {
  return store.get(scopeKey(companyId, documentKind, documentId)) ?? [];
}

export function addMockAttachment(
  companyId: string,
  documentKind: AttachmentDocumentKind,
  documentId: string,
  record: MockAttachmentRecord,
): void {
  const key = scopeKey(companyId, documentKind, documentId);
  store.set(key, [...(store.get(key) ?? []), record]);
}

export function removeMockAttachment(companyId: string, documentKind: AttachmentDocumentKind, documentId: string, attachmentId: string): boolean {
  const key = scopeKey(companyId, documentKind, documentId);
  const list = store.get(key) ?? [];
  const next = list.filter((a) => a.id !== attachmentId);
  store.set(key, next);
  return next.length !== list.length;
}

export function getMockAttachment(
  companyId: string,
  documentKind: AttachmentDocumentKind,
  documentId: string,
  attachmentId: string,
): MockAttachmentRecord | undefined {
  return listMockAttachments(companyId, documentKind, documentId).find((a) => a.id === attachmentId);
}

export function resetAttachmentsMock(): void {
  store.clear();
  mockActive = false;
}
