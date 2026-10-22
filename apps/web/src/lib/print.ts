// ---------------------------------------------------------------------------
// Isolated iframe printing — prints the outerHTML of a DOM element in a clean
// iframe with all current stylesheets copied, so the printed output contains
// only the target element (no sidebar, navigation, or app chrome).
//
// Shared by InvoicePreviewDialog, report Print buttons, journal entry print,
// and any other printable document in PAKO.
// ---------------------------------------------------------------------------

export interface PrintOptions {
  /** CSS to inject into the print iframe (page size, margins, etc.) */
  extraCss?: string;
  /** Callback after print dialog closes */
  onAfterPrint?: () => void;
}

const DEFAULT_PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 15mm;
  }
  body {
    margin: 0;
    padding: 0;
    background: white;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Prevent row breaks inside table rows */
  table tr {
    break-inside: avoid;
  }
  /* Repeat table headers on every printed page */
  thead {
    display: table-header-group;
  }
`;

const LANDSCAPE_PRINT_CSS = `
  @page {
    size: A4 landscape;
    margin: 10mm 15mm;
  }
  body {
    margin: 0;
    padding: 0;
    background: white;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  table tr {
    break-inside: avoid;
  }
  thead {
    display: table-header-group;
  }
`;

/**
 * Prints the given HTML element in an isolated iframe.
 * Copies all stylesheets from the main document so Tailwind classes render correctly.
 */
export function printElement(element: HTMLElement, options?: PrintOptions): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }

  // Copy all stylesheets from the main document
  const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'));
  const styleHTML = stylesheets.map((s) => s.outerHTML).join("\n");
  const extraCss = options?.extraCss ?? DEFAULT_PRINT_CSS;

  iframeDoc.open();
  iframeDoc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${styleHTML}
  <style>${extraCss}</style>
</head>
<body>${element.outerHTML}</body>
</html>`);
  iframeDoc.close();

  function cleanup() {
    if (iframe.parentNode) document.body.removeChild(iframe);
    options?.onAfterPrint?.();
  }

  iframe.contentWindow?.addEventListener("afterprint", cleanup);
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // Fallback cleanup after 5s if afterprint doesn't fire
    setTimeout(() => {
      if (iframe.parentNode) cleanup();
    }, 5000);
  }, 300);
}

/** Shorthand for landscape reports (trial balance, ledger, etc.) */
export function printElementLandscape(element: HTMLElement, options?: Omit<PrintOptions, "extraCss">): void {
  printElement(element, { ...options, extraCss: LANDSCAPE_PRINT_CSS });
}
