import { useRef } from "react";
import { useIntl } from "react-intl";
import { Printer, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InvoiceDocument, type InvoiceDocumentData } from "@/components/shared/InvoiceDocument";
import { printElement } from "@/lib/print";

// ---------------------------------------------------------------------------
// InvoicePreviewDialog — full-screen overlay showing the InvoiceDocument at A4
// proportions with Print and Download PDF actions.
//
// Uses the shared printElement() utility (lib/print.ts) which prints via an
// isolated iframe, ensuring the output contains only the invoice document.
// The browser's "Save as PDF" option in the print dialog serves as PDF export.
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

  function handlePrint() {
    const el = documentRef.current;
    if (el) printElement(el, { extraCss: INVOICE_PRINT_CSS });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center justify-between bg-background border-b px-4">
        <h2 className="text-sm font-medium">
          {intl.formatMessage({ id: "invoicePreview.title" })}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="xs" onClick={handlePrint}>
            <Printer className="size-3.5" />
            {intl.formatMessage({ id: "invoicePreview.print" })}
          </Button>
          <Button variant="outline" size="xs" onClick={handlePrint}>
            <Download className="size-3.5" />
            {intl.formatMessage({ id: "invoicePreview.downloadPdf" })}
          </Button>
          <Button variant="ghost" size="xs" onClick={onClose}>
            <X className="size-3.5" />
            {intl.formatMessage({ id: "common.close" })}
          </Button>
        </div>
      </div>

      {/* Scrollable preview area */}
      <div className="flex-1 overflow-auto p-8 flex justify-center">
        <div
          ref={documentRef}
          className="shadow-2xl"
          style={{ maxWidth: "210mm" }}
        >
          <InvoiceDocument data={data} />
        </div>
      </div>
    </div>
  );
}
