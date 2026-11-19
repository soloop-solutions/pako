import { useRef, useState } from "react";
import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { printElement } from "@/lib/print";
import { CopyButton } from "@/pages/desktop/CopyButton";

export function RecoveryCodeDisplay({ code, onContinue }: { code: string; onContinue: () => void }) {
  const intl = useIntl();
  const [saved, setSaved] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <div ref={codeRef}>
        <p className="rounded-md border border-warning-border bg-warning px-3 py-4 text-center font-mono text-lg font-semibold tracking-wider text-warning-foreground select-all">
          {code}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => codeRef.current && printElement(codeRef.current)}>
          {intl.formatMessage({ id: "common.print" })}
        </Button>
        <CopyButton value={code} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {intl.formatMessage({ id: "desktop.firstRun.saved" })}
      </label>
      <Button type="button" disabled={!saved} onClick={onContinue}>
        {intl.formatMessage({ id: "desktop.firstRun.continue" })}
      </Button>
    </div>
  );
}
