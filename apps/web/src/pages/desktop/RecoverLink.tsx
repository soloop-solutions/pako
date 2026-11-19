import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { useDesktopSetup } from "@/pages/desktop/useDesktopSetup";

export function RecoverLink() {
  const intl = useIntl();
  const { available } = useDesktopSetup();
  if (!available) return null;
  return (
    <Link className="-mt-2 self-end text-xs text-muted-foreground underline" to="/recover-admin">
      {intl.formatMessage({ id: "desktop.recover.link" })}
    </Link>
  );
}
