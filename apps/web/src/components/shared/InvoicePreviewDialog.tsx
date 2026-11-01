import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { ArrowLeft, Printer, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InvoiceDocument, type InvoiceDocumentData } from "@/components/shared/InvoiceDocument";
import { printElement } from "@/lib/print";

// ---------------------------------------------------------------------------
// InvoicePreviewDialog — full-screen overlay showing the InvoiceDocument.
//
// Portals to document.body so it escapes any parent overflow/z-index context
// (e.g. the FormDialog's scrollable container). The document renders at a
// readable width (capped at 800px) and scrolls vertically if taller than the
// viewport — no scale transform needed, text stays crisp and legible.
// ---------------------------------------------------------------------------

interface InvoicePreviewDialogProps {
  data: InvoiceDocumentData;
  onClose: () => void;
}

const INVOICE_PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 0;
  }
  body {
    margin: 0;
    padding: 0;
    background: white;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-document {
    width: 210mm !important;
    min-height: auto !important;
    padding: 20mm !important;
    margin: 0 !important;
    box-shadow: none !important;
  }
  table tr {
    break-inside: avoid;
  }
  thead {
    display: table-header-group;
  }
`;

export function InvoicePreviewDialog({ data, onClose }: InvoicePreviewDialogProps) {
  const intl = useIntl();
  const documentRef = useRef<HTMLDivElement>(null);

  // Escape key to close — capture phase so we intercept before Radix Dialog
  // sees it and closes the FormDialog underneath.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // Lock body scroll while overlay is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function handlePrint() {
    const el = documentRef.current;
    if (el) printElement(el, { extraCss: INVOICE_PRINT_CSS });
  }

  const overlay = (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: 9999 }}
      role="dialog"
      aria-modal="true"
      data-pako-overlay
    >
      {/* Toolbar */}
      <div className="relative flex h-12 shrink-0 items-center justify-between bg-background border-b px-4 shadow-sm">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeft className="size-4" />
          {intl.formatMessage({ id: "invoicePreview.backToForm" })}
        </Button>
        <h2 className="text-sm font-medium">
          {intl.formatMessage({ id: "invoicePreview.title" })}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="size-4" />
            {intl.formatMessage({ id: "invoicePreview.print" })}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Download className="size-4" />
            {intl.formatMessage({ id: "invoicePreview.downloadPdf" })}
          </Button>
        </div>
      </div>

      {/* Scrollable preview area with dark background */}
      <div className="flex-1 overflow-y-auto bg-neutral-800/95 py-8 px-4">
        <div className="mx-auto w-full max-w-[800px]">
          <div ref={documentRef} className="rounded shadow-2xl">
            <InvoiceDocument data={data} />
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
