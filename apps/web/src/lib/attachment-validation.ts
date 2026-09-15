// F11 (attachments) — pure, framework-free validation shared by the real drop-zone component
// (src/pages/shared/AttachmentsPanel.tsx) and the fully mocked upload handler
// (src/mocks/attachmentsHandlers.ts), so the two can never silently drift on what's accepted.

export const ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];

export type AttachmentValidationError = "unsupported-type" | "too-large";

export function validateAttachmentFile(file: { type: string; size: number }): AttachmentValidationError | null {
  if (!ATTACHMENT_ACCEPTED_TYPES.includes(file.type)) return "unsupported-type";
  if (file.size > ATTACHMENT_MAX_SIZE_BYTES) return "too-large";
  return null;
}

export function isImageAttachmentType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

export function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
