import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { getDesktopBridge } from "@/lib/desktopBridge";

export function SubmitToAtkButton() {
  const intl = useIntl();
  if (!getDesktopBridge()) return null;
  const text = intl.formatMessage({ id: "desktop.atkNotAvailable" });
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled title={text}>
        {intl.formatMessage({ id: "desktop.submitToAtk" })}
      </Button>
      <span className="text-xs text-muted-foreground">{text}</span>
    </div>
  );
}
