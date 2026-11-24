import { useState } from "react";
import { useIntl } from "react-intl";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHotkey } from "@/hooks/useHotkey";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// App-wide shortcuts (client request 2026-11-24): "/" focuses the current list's search box and "?"
// lists every shortcut. "N" (new) and Ctrl+S (save) are registered by the pages that offer them.
export function KeyboardShortcuts() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [open, setOpen] = useState(false);

  useHotkey("?", () => setOpen(true));
  useHotkey("/", () => {
    const search = document.querySelector<HTMLInputElement>("main [data-grid-search]");
    search?.focus();
    search?.select();
  });

  const mod = IS_MAC ? "⌘" : "Ctrl";
  const rows: [string, string][] = [
    ["N", t("shortcuts.newDocument")],
    ["/", t("shortcuts.search")],
    [`${mod}+S`, t("shortcuts.save")],
    [`${mod}+K`, t("shortcuts.globalSearch")],
    ["Ctrl+Tab", t("shortcuts.nextTab")],
    ["?", t("shortcuts.help")],
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {rows.map(([keys, label]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
