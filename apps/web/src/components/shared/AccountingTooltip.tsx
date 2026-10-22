import { HelpCircle } from "lucide-react";
import { useIntl } from "react-intl";

interface AccountingTooltipProps {
  /** i18n key whose value becomes the tooltip text */
  termKey: string;
}

/**
 * A small help icon that shows an accounting explanation on hover.
 * Uses the native `title` attribute on a wrapping span so it works
 * everywhere without pulling in a tooltip library.
 */
export function AccountingTooltip({ termKey }: AccountingTooltipProps) {
  const intl = useIntl();
  const text = intl.formatMessage({ id: termKey });
  return (
    <span title={text} aria-label={text} className="ml-1 inline-flex items-center">
      <HelpCircle className="size-3.5 shrink-0 text-muted-foreground/60" />
    </span>
  );
}
