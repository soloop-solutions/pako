import { type RefObject } from "react";
import { useIntl } from "react-intl";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { printElement, printElementLandscape } from "@/lib/print";

interface PrintButtonProps {
  /** Ref to the DOM element to print */
  contentRef: RefObject<HTMLElement | null>;
  /** Use landscape orientation (default: false = portrait) */
  landscape?: boolean;
  /** Button variant (default: outline) */
  variant?: "outline" | "ghost" | "default";
  /** Button size (default: xs) */
  size?: "xs" | "sm" | "default";
  /** Override label (defaults to localized "Print") */
  label?: string;
}

export function PrintButton({
  contentRef,
  landscape = false,
  variant = "outline",
  size = "xs",
  label,
}: PrintButtonProps) {
  const intl = useIntl();

  function handleClick() {
    const el = contentRef.current;
    if (!el) return;
    if (landscape) {
      printElementLandscape(el);
    } else {
      printElement(el);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={handleClick}>
      <Printer className="size-3.5" />
      {label ?? intl.formatMessage({ id: "common.print" })}
    </Button>
  );
}
