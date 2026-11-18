import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { useDesktopSetup } from "@/pages/desktop/useDesktopSetup";

export function AccessLinkEntry() {
  const intl = useIntl();
  const { available } = useDesktopSetup();
  if (!available) return null;
  return (
    <Link className="-mt-2 self-end text-xs text-muted-foreground underline" to="/use-link">
      {intl.formatMessage({ id: "desktop.accessLink.entry" })}
    </Link>
  );
}
