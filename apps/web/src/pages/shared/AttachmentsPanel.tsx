import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import { useIntl } from "react-intl";
import { FileText, Paperclip, Trash2, Upload, X } from "lucide-react";

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
import {
  ATTACHMENT_ACCEPTED_TYPES,
  ATTACHMENT_MAX_SIZE_BYTES,
  formatAttachmentSize,
  isImageAttachmentType,
  validateAttachmentFile,
} from "@/lib/attachment-validation";
import { cn } from "@/lib/utils";

type AttachmentsPanelProps = {
  companyId: string;
  documentKind: AttachmentDocumentKind;
  documentId: string;
  readOnly?: boolean;
};

interface AttachmentWithPreview extends Attachment {
  previewUrl?: string;
}

export function AttachmentsPanel({ companyId, documentKind, documentId, readOnly = false }: AttachmentsPanelProps) {
  const intl = useIntl();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  // Drag counter: incremented on dragenter, decremented on dragleave. Only when it
  // reaches 0 do we remove the highlight. This fixes the flicker caused by child elements
  // firing their own enter/leave events.
  const dragCounter = useRef(0);
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
      setError(err instanceof Error && err.message ? err.message : intl.formatMessage({ id: "attachments.loadError" }));
    }
  }, [companyId, documentKind, documentId, getContentUrl, intl]);

  useEffect(() => {
    const cache = objectUrlCache.current;
    void refresh();
    return () => {
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

  // --- Paste support: listen for Ctrl+V / Cmd+V with image data ---
  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (readOnly || uploading) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      void handleFiles(files);
    }
  }

  async function handleFiles(files: File[] | FileList | null) {
    if (!files || (files instanceof FileList && files.length === 0) || (Array.isArray(files) && files.length === 0))
      return;
    setError(null);
    setUploading(true);
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
      setError(err instanceof Error && err.message ? err.message : intl.formatMessage({ id: "attachments.uploadError" }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // --- Drag handlers with counter to prevent child-element flicker ---
  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current++;
    if (!dragActive) setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    void handleFiles(event.target.files);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
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
      setError(err instanceof Error && err.message ? err.message : intl.formatMessage({ id: "attachments.deleteError" }));
    }
  }

  function openOriginal(attachment: AttachmentWithPreview) {
    getContentUrl(attachment.id)
      .then((url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      })
      .catch((err) => {
        setError(err instanceof Error && err.message ? err.message : intl.formatMessage({ id: "attachments.loadError" }));
      });
  }

  const selectedAttachment = attachments.find((a) => a.id === selectedId) ?? null;
  const acceptString = ATTACHMENT_ACCEPTED_TYPES.join(",");
  const maxSizeMb = ATTACHMENT_MAX_SIZE_BYTES / (1024 * 1024);

  return (
    // tabIndex makes the div focusable so paste events fire on it
    <div className="flex flex-col gap-4" onPaste={handlePaste} tabIndex={-1}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!readOnly && (
        <div
          ref={dropRef}
          data-testid="attachments-dropzone"
          role="button"
          tabIndex={0}
          onClick={openFilePicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openFilePicker();
            }
          }}
          className={cn(
            "group relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-5 text-center text-sm transition-colors",
            "hover:border-primary/50 hover:bg-accent/50",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]",
            dragActive ? "border-primary bg-accent" : "border-muted-foreground/25",
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload className={cn("size-5 transition-colors", dragActive ? "text-primary" : "text-muted-foreground")} />
          <p className={cn("font-medium transition-colors", dragActive ? "text-primary" : "text-muted-foreground")}>
            {dragActive
              ? intl.formatMessage({ id: "attachments.dropZoneActiveHint" })
              : intl.formatMessage({ id: "attachments.dropZoneHint" })}
          </p>
          <p className="text-xs text-muted-foreground/70">
            {intl.formatMessage({ id: "attachments.dropZoneFormats" }, { maxSizeMb })}
          </p>
          {uploading && (
            <p className="text-xs font-medium text-primary">{intl.formatMessage({ id: "attachments.uploading" })}</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptString}
            disabled={uploading}
            onChange={handleFileInputChange}
            className="sr-only"
            aria-label={intl.formatMessage({ id: "attachments.browseFiles" })}
          />
        </div>
      )}

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "attachments.empty" })}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2 transition-colors",
                selectedId === attachment.id && "bg-accent",
              )}
            >
              {/* Thumbnail */}
              <button
                type="button"
                className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted"
                onClick={() => setSelectedId(selectedId === attachment.id ? null : attachment.id)}
                aria-label={intl.formatMessage({ id: "attachments.select" }, { fileName: attachment.fileName })}
              >
                {attachment.previewUrl ? (
                  <img src={attachment.previewUrl} alt={attachment.fileName} className="size-full object-cover" />
                ) : (
                  <FileText className="size-4 text-muted-foreground" />
                )}
              </button>

              {/* File info */}
              <div className="flex min-w-0 flex-1 flex-col">
                <button
                  type="button"
                  className="truncate text-left text-sm font-medium hover:underline"
                  title={attachment.fileName}
                  onClick={() => openOriginal(attachment)}
                >
                  {attachment.fileName}
                </button>
                <span className="text-xs text-muted-foreground">{formatAttachmentSize(attachment.sizeBytes)}</span>
              </div>

              {/* Actions */}
              {!readOnly &&
                (confirmingDeleteId === attachment.id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="xs"
                      variant="destructive"
                      onClick={() => void handleDelete(attachment.id)}
                    >
                      {intl.formatMessage({ id: "common.confirm" })}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setConfirmingDeleteId(null)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmingDeleteId(attachment.id)}
                    aria-label={intl.formatMessage({ id: "attachments.delete" }, { fileName: attachment.fileName })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}

      {/* Attachment count badge when there are files */}
      {attachments.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3" />
          {intl.formatMessage({ id: "attachments.count" }, { count: attachments.length })}
        </p>
      )}

      {selectedAttachment && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm font-medium">{intl.formatMessage({ id: "attachments.previewTitle" })}</p>
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded bg-muted">
              {selectedUrl && isImageAttachmentType(selectedAttachment.contentType) ? (
                <img
                  src={selectedUrl}
                  alt={selectedAttachment.fileName}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <FileText className="size-10" />
                  <span className="text-xs">{selectedAttachment.fileName}</span>
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => openOriginal(selectedAttachment)}
            >
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
