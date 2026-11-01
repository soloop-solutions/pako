import { printElement } from "@/lib/print";

// 80 mm thermal roll. `size` takes one or two lengths (or a keyword) — "80mm auto" is invalid
// and browsers drop the whole rule, falling back to A4. A4's height is a valid placeholder: roll
// printer drivers cut after the last printed line, so the coupon does not waste paper.
export const COUPON_PRINT_CSS = `
  @page { size: 80mm 297mm; margin: 3mm; }
  body { margin: 0; padding: 0; background: white; }
`;

export function printCoupon(element: HTMLElement | null) {
  if (element) printElement(element, { extraCss: COUPON_PRINT_CSS });
}
