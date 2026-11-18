import { useState } from "react";
import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";

export function CopyButton({ value }: { value: string }) {
  const intl = useIntl();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {intl.formatMessage({ id: copied ? "desktop.copied" : "desktop.copy" })}
    </Button>
  );
}
