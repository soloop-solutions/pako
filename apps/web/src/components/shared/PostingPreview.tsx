import { useEffect, useState } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { PostingPreviewResponse } from "@pako/shared";

interface PostingPreviewProps {
  companyId: string;
  documentKind: "invoice" | "bill";
  documentId: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
}

/**
 * Modal overlay that fetches and displays the journal entry lines that posting
 * a document would create. The user can confirm (post) or cancel.
 *
 * Uses the generated API client's postPreview/postPreview2 methods.
 */
export function PostingPreview({ companyId, documentKind, documentId, onConfirm, onCancel, confirming }: PostingPreviewProps) {
  const intl = useIntl();
  const [preview, setPreview] = useState<PostingPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchPreview() {
      setLoading(true);
      setError(null);
      try {
        const data = documentKind === "invoice"
          ? await apiClient.postPreview(companyId, documentId)
          : await apiClient.postPreview2(companyId, documentId);
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, intl.formatMessage({ id: "posting.preview.loadError" })));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [companyId, documentKind, documentId, intl]);

  const totalDebits = preview?.lines.reduce((sum, l) => sum + l.debit, 0) ?? 0;
  const totalCredits = preview?.lines.reduce((sum, l) => sum + l.credit, 0) ?? 0;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        // Close when clicking backdrop itself, not the card
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <Card className="mx-4 w-full max-w-2xl max-h-[80vh] flex flex-col shadow-lg">
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "posting.preview.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "posting.preview.description" })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 overflow-auto">
          {loading && (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{intl.formatMessage({ id: "posting.preview.accountCode" })}</TableHead>
                    <TableHead>{intl.formatMessage({ id: "posting.preview.accountName" })}</TableHead>
                    <TableHead className="text-right tabular-nums">{intl.formatMessage({ id: "posting.preview.debit" })}</TableHead>
                    <TableHead className="text-right tabular-nums">{intl.formatMessage({ id: "posting.preview.credit" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.lines.map((line, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-sm">{line.accountCode}</TableCell>
                      <TableCell>{line.accountName}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.debit > 0 ? line.debit.toFixed(2) : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.credit > 0 ? line.credit.toFixed(2) : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-medium">
                    <TableCell colSpan={2} className="text-right">
                      {intl.formatMessage({ id: "posting.preview.totalDebits" })} / {intl.formatMessage({ id: "posting.preview.totalCredits" })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{totalDebits.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{totalCredits.toFixed(2)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onCancel} disabled={confirming}>
                  {intl.formatMessage({ id: "posting.preview.cancel" })}
                </Button>
                <Button onClick={onConfirm} disabled={confirming}>
                  {confirming
                    ? intl.formatMessage({ id: "common.loading" })
                    : intl.formatMessage({ id: "posting.preview.confirm" })}
                </Button>
              </div>
            </>
          )}

          {!loading && !preview && !error && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel}>
                {intl.formatMessage({ id: "posting.preview.cancel" })}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
