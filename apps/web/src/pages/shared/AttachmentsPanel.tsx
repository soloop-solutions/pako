import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useIntl } from "react-intl";
import { FileText, Trash2, Upload } from "lucide-react";

import {
  deleteAttachment,
  fetchAttachmentContent,
  fetchAttachments,
  uploadAttachment,
  type Attachment,
  type AttachmentDocumentKind,
} from "@/api/attachments-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAttachmentSize, isImageAttachmentType, validateAttachmentFile } from "@/lib/attachment-validation";
import { cn } from "@/lib/utils";
import { setAttachmentsMockActive } from "@/mocks/attachmentsMockFlag";
import { ensureAccountsMockWorkerStarted } from "@/mocks/mockInit";

// F11 — see src/mocks/attachmentsHandlers.ts for the invented contract this talks to. Shared
// between InvoiceDetail.tsx and BillDetail.tsx, same composition style as RecordPaymentForm.tsx/
// ApplyCreditNoteForm.tsx/EditPostedFieldsForm.tsx on those pages.
type AttachmentsPanelProps = {
  companyId: string;
  documentKind: AttachmentDocumentKind;
  documentId: string;
};

interface AttachmentWithPreview extends Attachment {
  previewUrl?: string;
}

export function AttachmentsPanel({ companyId, documentKind, documentId }: AttachmentsPanelProps) {
  const intl = useIntl();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // One object URL per attachment id, created lazily and reused — shared by the grid thumbnail,
  // the selected-item preview and "open original", so a given file's bytes are only ever fetched
  // and turned into an object URL once per mount. Revoked on unmount only; the underlying file
  // content itself lives in src/mocks/attachmentsMockFlag.ts's module-level store, which is NOT
  // cleared on unmount — that's what makes an attachment survive navigating away and back.
  const objectUrlCache = useRef<Map<string, string>>(new Map());

  const [attachments, setAttachments] = useState<AttachmentWithPreview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const getContentUrl = useCallback(
    async (attachmentId: string): Promise<string> => {
      const cached = objectUrlCache.current.get(attachmentId);
      if (cached) return cached;
      const blob = await fetchAttachmentContent(companyId, documentKind, documentId, attachmentId);
      const url = URL.createObjectURL(blob);
      objectUrlCache.current.set(attachmentId, url);
      return url;
    },
    [companyId, documentKind, documentId],
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchAttachments(companyId, documentKind, documentId);
      const withThumbnails = await Promise.all(
        list.map(async (attachment): Promise<AttachmentWithPreview> => {
          if (!isImageAttachmentType(attachment.contentType)) return attachment;
          try {
            return { ...attachment, previewUrl: await getContentUrl(attachment.id) };
          } catch {
            return attachment;
          }
        }),
      );
      setAttachments(withThumbnails);
    } catch (err) {
      setError(err instanceof Error ? err.message : intl.formatMessage({ id: "attachments.loadError" }));
    }
  }, [companyId, documentKind, documentId, getContentUrl, intl]);

  // The shared mock Service Worker isn't guaranteed to already be running — a screen that lands
  // here directly (not via Partners/Items/Ledger, which each also start it) would otherwise fire
  // real fetches against the mocked attachments endpoints and get real 404s. Partners.tsx/
  // JournalEntryGrid.tsx face the same gap but gate a TanStack `useQuery`'s declarative `enabled`
  // on a `mockReady` flag; this screen fetches manually via `refresh()`, so
  // the equivalent is awaiting the same promise before calling it, in one effect — not a second
  // effect keyed on a `mockReady` state, which raced against `refresh()`'s own state updates
  // (only surfaced as a flaky test under full-suite load, not in isolation).
  useEffect(() => {
    setAttachmentsMockActive(true);
    let cancelled = false;
    const cache = objectUrlCache.current;
    void ensureAccountsMockWorkerStarted().then(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
      setAttachmentsMockActive(false);
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, documentKind, documentId]);

  useEffect(() => {
    setSelectedId(null);
  }, [documentId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedUrl(null);
      return;
    }
    let cancelled = false;
    getContentUrl(selectedId)
      .then((url) => {
        if (!cancelled) setSelectedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setSelectedUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, getContentUrl]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    // Validation failures are collected and surfaced only AFTER refresh() below, deliberately —
    // refresh() clears the error state at its own start (it has its own load-failure case to
    // report), so setting a validation message before calling it would get silently wiped the
    // instant the (successful) refetch resolves.
    let validationMessage: string | null = null;
    let uploadedAny = false;
    try {
      for (const file of Array.from(files)) {
        const validationError = validateAttachmentFile(file);
        if (validationError === "unsupported-type") {
          validationMessage = intl.formatMessage({ id: "attachments.unsupportedType" }, { fileName: file.name });
          continue;
        }
        if (validationError === "too-large") {
          validationMessage = intl.formatMessage({ id: "attachments.tooLarge" }, { fileName: file.name });
          continue;
        }
        await uploadAttachment(companyId, documentKind, documentId, file);
        uploadedAny = true;
      }
      if (uploadedAny) await refresh();
      if (validationMessage) setError(validationMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : intl.formatMessage({ id: "attachments.uploadError" }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    void handleFiles(event.target.files);
  }

  async function handleDelete(attachmentId: string) {
    setError(null);
    try {
      await deleteAttachment(companyId, documentKind, documentId, attachmentId);
      const cachedUrl = objectUrlCache.current.get(attachmentId);
      if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl);
        objectUrlCache.current.delete(attachmentId);
      }
      setConfirmingDeleteId(null);
      if (selectedId === attachmentId) setSelectedId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : intl.formatMessage({ id: "attachments.deleteError" }));
    }
  }

  function openOriginal(attachment: AttachmentWithPreview) {
    getContentUrl(attachment.id)
      .then((url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : intl.formatMessage({ id: "attachments.loadError" }));
      });
  }

  const selectedAttachment = attachments.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div
        data-testid="attachments-dropzone"
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
          dragActive ? "border-primary bg-accent" : "border-muted-foreground/30",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <Upload className="size-5 text-muted-foreground" />
        <p className="text-muted-foreground">{intl.formatMessage({ id: "attachments.dropZoneHint" })}</p>
        <div className="flex flex-col items-center gap-1">
          <Label htmlFor="attachments-file-input">{intl.formatMessage({ id: "attachments.browseFiles" })}</Label>
          <Input
            ref={fileInputRef}
            id="attachments-file-input"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            disabled={uploading}
            onChange={handleFileInputChange}
            className="h-auto max-w-xs text-xs"
          />
        </div>
        {uploading && <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "attachments.uploading" })}</p>}
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "attachments.empty" })}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <div
                className={cn(
                  "flex flex-col gap-2 rounded-md border p-2 text-left transition-colors",
                  selectedId === attachment.id ? "border-primary bg-accent" : "border-border",
                )}
              >
                <button
                  type="button"
                  className="flex aspect-square w-full items-center justify-center overflow-hidden rounded bg-muted"
                  onClick={() => setSelectedId(attachment.id)}
                  aria-label={intl.formatMessage({ id: "attachments.select" }, { fileName: attachment.fileName })}
                >
                  {attachment.previewUrl ? (
                    <img src={attachment.previewUrl} alt={attachment.fileName} className="size-full object-cover" />
                  ) : (
                    <FileText className="size-8 text-muted-foreground" />
                  )}
                </button>
                <p className="truncate text-xs font-medium" title={attachment.fileName}>
                  {attachment.fileName}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{formatAttachmentSize(attachment.sizeBytes)}</span>
                  {confirmingDeleteId === attachment.id ? (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => void handleDelete(attachment.id)}>
                        {intl.formatMessage({ id: "common.confirm" })}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmingDeleteId(null)}>
                        {intl.formatMessage({ id: "common.cancel" })}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-destructive"
                      onClick={() => setConfirmingDeleteId(attachment.id)}
                      aria-label={intl.formatMessage({ id: "attachments.delete" }, { fileName: attachment.fileName })}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selectedAttachment && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm font-medium">{intl.formatMessage({ id: "attachments.previewTitle" })}</p>
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded bg-muted">
              {selectedUrl && isImageAttachmentType(selectedAttachment.contentType) ? (
                <img src={selectedUrl} alt={selectedAttachment.fileName} className="max-h-full max-w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <FileText className="size-10" />
                  <span className="text-xs">{selectedAttachment.fileName}</span>
                </div>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => openOriginal(selectedAttachment)}>
              {intl.formatMessage({ id: "attachments.openOriginal" })}
            </Button>
          </div>

          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
            <p className="font-medium">{intl.formatMessage({ id: "attachments.extractedFieldsTitle" })}</p>
            <p>{intl.formatMessage({ id: "attachments.extractedFieldsPlaceholder" })}</p>
          </div>
        </div>
      )}
    </div>
  );
}
