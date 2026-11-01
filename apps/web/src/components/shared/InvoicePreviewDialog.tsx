import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Printer, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InvoiceDocument, type InvoiceDocumentData } from "@/components/shared/InvoiceDocument";
import { printElement } from "@/lib/print";

// ---------------------------------------------------------------------------
// InvoicePreviewDialog — full-screen overlay showing the InvoiceDocument at A4
// proportions with Print and Download PDF actions.
//
// The document is scaled to fit the viewport so the user sees the full page
// without scrolling. Print still uses the original A4 dimensions.
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Calculate scale so the A4 document fits within the available container
  useEffect(() => {
    const container = containerRef.current;
    const doc = documentRef.current;
    if (!container || !doc) return;

    function recalc() {
      const ch = container!.clientHeight - 32; // subtract padding (16px top+bottom)
      const cw = container!.clientWidth - 32;
      const dh = doc!.scrollHeight;
      const dw = doc!.scrollWidth;
      if (dh === 0 || dw === 0) return;
      const s = Math.min(ch / dh, cw / dw, 1); // never scale up
      setScale(s);
    }

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    ro.observe(doc);
    return () => ro.disconnect();
  }, []);

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

      {/* Preview area — document scaled to fit without scrolling */}
      <div ref={containerRef} className="flex-1 overflow-hidden flex items-center justify-center p-4">
        <div
          ref={documentRef}
          className="shadow-2xl origin-center"
          style={{
            maxWidth: "210mm",
            transform: `scale(${scale})`,
          }}
        >
          <InvoiceDocument data={data} />
        </div>
      </div>
    </div>
  );
}
