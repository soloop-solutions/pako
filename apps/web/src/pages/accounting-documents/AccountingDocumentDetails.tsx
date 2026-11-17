import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Download, FileX, Loader2, Trash2, Upload } from "lucide-react";

import {
  deleteAccountingDocument,
  downloadAccountingDocument,
  fetchAccountingDocuments,
  uploadAccountingDocument,
  type AccountingDocument,
  type AccountingDocumentType,
} from "@/api/accounting-documents-client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useCompany } from "@/context/CompanyContext";
import { useConfirm } from "@/components/ui/confirm-context";
import { monthName } from "@/pages/accounting-documents/month-names";

const ACCEPTED = ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png";

function toApiType(type: string): AccountingDocumentType {
  return type === "sell" ? "Sell" : "Buy";
}

export function AccountingDocumentDetails() {
  const intl = useIntl();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { activeCompanyId } = useCompany();
  const { year, month, type } = useParams<{ year: string; month: string; type: string }>();
  const locale = intl.locale;

  const yearNum = Number(year);
  const monthNum = Number(month);
  const mName = monthName(monthNum, locale);
  const apiType = toApiType(type ?? "buy");
  const typeLabel =
    type === "sell"
      ? intl.formatMessage({ id: "accountingDocuments.sell" })
      : intl.formatMessage({ id: "accountingDocuments.buy" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<AccountingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const result = await fetchAccountingDocuments(activeCompanyId, yearNum, monthNum, apiType);
      setDocuments(result.items);
    } catch {
      // silent — the list just stays empty
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, yearNum, monthNum, apiType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !activeCompanyId) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadAccountingDocument(activeCompanyId, yearNum, monthNum, apiType, file);
      }
      toast.success(intl.formatMessage({ id: "accountingDocuments.uploadSuccess" }));
      await refresh();
    } catch {
      toast.error(intl.formatMessage({ id: "accountingDocuments.uploadError" }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownload(doc: AccountingDocument) {
    if (!activeCompanyId) return;
    try {
      const blob = await downloadAccountingDocument(activeCompanyId, doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(intl.formatMessage({ id: "accountingDocuments.downloadError" }));
    }
  }

  function handleDelete(doc: AccountingDocument) {
    if (!activeCompanyId) return;
    confirm(
      intl.formatMessage({ id: "accountingDocuments.deleteConfirm" }),
      async () => {
        try {
          await deleteAccountingDocument(activeCompanyId, doc.id);
          toast.success(intl.formatMessage({ id: "accountingDocuments.deleteSuccess" }));
          await refresh();
        } catch {
          toast.error(intl.formatMessage({ id: "accountingDocuments.deleteError" }));
        }
      },
      {
        confirmLabel: intl.formatMessage({ id: "accountingDocuments.delete" }),
        destructive: true,
      },
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Back + Title */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void navigate(`/accounting-documents/${year}/${month}`)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {intl.formatMessage({ id: "accountingDocuments.back" })}
        </button>
        <h1 className="text-xl font-semibold">
          {intl.formatMessage(
            { id: "accountingDocuments.monthTitle" },
            { year: yearNum, month: mName },
          )}{" "}
          - {typeLabel}
        </h1>
      </div>

      {/* Upload button */}
      <div>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {uploading
            ? intl.formatMessage({ id: "accountingDocuments.uploading" })
            : intl.formatMessage({ id: "accountingDocuments.upload" })}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          disabled={uploading}
          onChange={(e) => void handleUpload(e.target.files)}
          className="sr-only"
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">
            {intl.formatMessage({ id: "accountingDocuments.loading" })}
          </span>
        </div>
      )}

      {/* Empty state */}
      {!loading && documents.length === 0 && (
        <EmptyState
          icon={FileX}
          title={intl.formatMessage(
            { id: "accountingDocuments.noDocuments" },
            { month: mName, type: typeLabel },
          )}
        />
      )}

      {/* Document table */}
      {!loading && documents.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium">
                  {intl.formatMessage({ id: "accountingDocuments.documentName" })}
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  {intl.formatMessage({ id: "accountingDocuments.date" })}
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  {intl.formatMessage({ id: "accountingDocuments.actions" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{doc.fileName}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {new Date(doc.uploadedAt).toLocaleDateString(locale === "sq" ? "sq-XK" : "en-GB", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </td>
                  <td className="flex items-center justify-end gap-2 px-4 py-2.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleDownload(doc)}
                    >
                      <Download className="size-4" />
                      {intl.formatMessage({ id: "accountingDocuments.download" })}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(doc)}
                    >
                      <Trash2 className="size-4" />
                      {intl.formatMessage({ id: "accountingDocuments.delete" })}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
