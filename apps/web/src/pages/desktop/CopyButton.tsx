import { useState } from "react";
import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";

export function CopyButton({ value }: { value: string }) {
  const intl = useIntl();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          try {
            void navigator.clipboard.writeText(value).then(
              () => setState("copied"),
              () => setState("failed"),
            );
          } catch {
            setState("failed");
          }
        }}
      >
        {intl.formatMessage({ id: state === "copied" ? "desktop.copied" : "desktop.copy" })}
      </Button>
      {state === "failed" && (
        <span role="alert" className="text-xs font-medium text-destructive">
          {intl.formatMessage({ id: "desktop.copyFailed" })}
        </span>
      )}
    </>
  );
}
