// PROVISIONAL — F11 (attachments) mock contract. FULLY INVENTED, same category as F9's
// cost-center mock (see src/mocks/costCentersHandlers.ts's header) — confirmed by reading
// `backend/` directly: no `IFormFile` usage anywhere, no attachments table/entity/controller.
// docs/ACCOUNTANT_MILESTONE.md itself flags this gap explicitly. There is no real endpoint to
// splice onto or bypass to, unlike F6's partner mock.
//
// Invented REST contract (state this shape clearly for whoever reconciles it with the real
// backend later):
//
//   GET    /api/companies/{companyId}/invoices/{invoiceId}/attachments
//   POST   /api/companies/{companyId}/invoices/{invoiceId}/attachments           (multipart/form-data, field "file")
//   DELETE /api/companies/{companyId}/invoices/{invoiceId}/attachments/{id}
//   GET    /api/companies/{companyId}/invoices/{invoiceId}/attachments/{id}/content
//
// ...and the same four under `.../bills/{billId}/attachments`, mirroring how ItemBarcode nests
// under `.../items/{itemId}/barcodes` and Reconciliation nests under `.../invoices/{id}/...` in
// the real generated client. List/create responses are `AttachmentResponse[]` /
// `AttachmentResponse` — `{ id, fileName, contentType, sizeBytes, uploadedAt }` (no
// uploadedByUserId — nothing in this mock's auth-free setup can populate it honestly, so it's left
// out rather than faked; the real backend should add it, it just isn't invented here). The
// `/content` endpoint returns the raw file bytes with the real `Content-Type` header — chosen so
// the frontend can render an authenticated `<img>`/"open original" the same way it would have to
// against a real backend (a Bearer-token API can't be used directly as a plain `<img src>`, so the
// component fetches `/content` with the same `authorizedFetch` as everything else and turns the
// resulting Blob into an object URL — see src/pages/shared/AttachmentsPanel.tsx).
//
// Upload validation (type allow-list + 10MB size cap) is enforced here too, not just client-side —
// defense in depth, matching this mock's own POST .../accounts precedent in src/mocks/handlers.ts.
// Both sides share the exact same limits from src/lib/attachment-validation.ts, so they can't drift.
//
// The actual file bytes are held in src/mocks/attachmentsMockFlag.ts's module-level store, not
// here — see that file's header for why (bundle-size discipline) and for the store's real point:
// it outlives a single mount, so an attachment survives navigating away from a document's detail
// page and back within the same session, per this task's explicit storage-scoping requirement.
//
// This is scaffolding to be torn out, not permanent product code:
//   1. Once a real AttachmentsController exists on the backend (whatever shape it actually lands
//      in — it will very likely NOT match this invented contract exactly), delete this file,
//      src/mocks/attachmentsMockFlag.ts, src/api/attachments-client.ts, and their registrations in
//      src/mocks/browser.ts / src/mocks/server.ts / src/test/setup.ts.
//   2. Regenerate packages/shared's client and replace every call in
//      src/pages/shared/AttachmentsPanel.tsx with the real generated `apiClient.*` methods —
//      re-check for the usual NSwag operation-name-collision gotcha (see repo CLAUDE.md).
//
// **Gated by its own synchronous flag**, same discipline as every other mock in this directory.

import { HttpResponse, http, passthrough } from "msw";

import { API_BASE_URL } from "@/api/client";
import { validateAttachmentFile } from "@/lib/attachment-validation";
import {
  addMockAttachment,
  getMockAttachment,
  isAttachmentsMockActive,
  listMockAttachments,
  removeMockAttachment,
  type AttachmentDocumentKind,
  type MockAttachmentRecord,
} from "@/mocks/attachmentsMockFlag";

function errorResponse(status: number, message: string) {
  return HttpResponse.json(message, { status });
}

function toResponseBody(record: MockAttachmentRecord) {
  return {
    id: record.id,
    fileName: record.fileName,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    uploadedAt: record.uploadedAt,
  };
}

function handlersForKind(documentKind: AttachmentDocumentKind, pathSegment: "invoices" | "bills") {
  return [
    http.get(`${API_BASE_URL}/api/companies/:companyId/${pathSegment}/:documentId/attachments`, ({ params }) => {
      if (!isAttachmentsMockActive()) return passthrough();
      const list = listMockAttachments(String(params.companyId), documentKind, String(params.documentId));
      return HttpResponse.json(list.map(toResponseBody));
    }),

    http.post(`${API_BASE_URL}/api/companies/:companyId/${pathSegment}/:documentId/attachments`, async ({ params, request }) => {
      if (!isAttachmentsMockActive()) return passthrough();

      // Node 26's undici throws an assertion error when parsing multipart/form-data in some
      // environments (MSW test interception). We use a two-stage approach: try the standard
      // formData() API first, and if that fails, parse the raw bytes ourselves.
      let file: File | Blob | null = null;
      let fileName = "attachment";

      // Clone the request so we can retry with arrayBuffer if formData() fails
      const cloned = request.clone();
      try {
        const formData = await request.formData();
        const rawFile = formData.get("file");
        if (typeof rawFile !== "string" && rawFile != null) {
          file = rawFile;
        }
        const fileNameField = formData.get("fileName");
        if (typeof fileNameField === "string" && fileNameField) {
          fileName = fileNameField;
        }
      } catch {
        // FormData parsing failed (Node 26 undici). Parse the multipart body from raw bytes.
        try {
          const ct = cloned.headers.get("content-type") ?? "";
          const boundaryMatch = ct.match(/boundary=([^\s;]+)/);
          if (boundaryMatch) {
            const rawBuf = await cloned.arrayBuffer();
            const raw = new TextDecoder().decode(rawBuf);
            const boundary = boundaryMatch[1];
            const parts = raw.split(`--${boundary}`);
            for (const part of parts) {
              if (!part.includes("Content-Disposition")) continue;
              const divider = part.indexOf("\r\n\r\n");
              if (divider === -1) continue;
              const headers = part.substring(0, divider);
              const body = part.substring(divider + 4).replace(/\r\n$/, "");
              if (headers.includes('name="fileName"')) {
                fileName = body.trim();
              } else if (headers.includes('name="file"')) {
                const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
                const fileType = ctMatch ? ctMatch[1].trim() : "application/octet-stream";
                file = new Blob([body], { type: fileType });
              }
            }
          }
        } catch {
          return errorResponse(400, "Could not read uploaded file.");
        }
      }
      if (file == null) {
        return errorResponse(400, "No file was uploaded.");
      }
      const validationError = validateAttachmentFile(file);
      if (validationError === "unsupported-type") {
        return errorResponse(400, `Unsupported file type "${file.type || "unknown"}". Upload an image (PNG/JPEG/GIF/WEBP) or a PDF.`);
      }
      if (validationError === "too-large") {
        return errorResponse(400, "File is too large. Maximum size is 10 MB.");
      }

      const record: MockAttachmentRecord = {
        id: crypto.randomUUID(),
        fileName,
        contentType: file.type,
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        blob: file,
      };
      addMockAttachment(String(params.companyId), documentKind, String(params.documentId), record);
      return HttpResponse.json(toResponseBody(record), { status: 201 });
    }),

    http.delete(`${API_BASE_URL}/api/companies/:companyId/${pathSegment}/:documentId/attachments/:attachmentId`, ({ params }) => {
      if (!isAttachmentsMockActive()) return passthrough();
      const removed = removeMockAttachment(String(params.companyId), documentKind, String(params.documentId), String(params.attachmentId));
      if (!removed) return errorResponse(404, "Attachment not found.");
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(`${API_BASE_URL}/api/companies/:companyId/${pathSegment}/:documentId/attachments/:attachmentId/content`, ({ params }) => {
      if (!isAttachmentsMockActive()) return passthrough();
      const record = getMockAttachment(String(params.companyId), documentKind, String(params.documentId), String(params.attachmentId));
      if (!record) return errorResponse(404, "Attachment not found.");
      return new HttpResponse(record.blob, { headers: { "Content-Type": record.contentType } });
    }),
  ];
}

export const attachmentsHandlers = [...handlersForKind("invoice", "invoices"), ...handlersForKind("bill", "bills")];
