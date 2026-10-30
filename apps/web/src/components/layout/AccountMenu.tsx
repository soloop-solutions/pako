import { useRef, useState, type KeyboardEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowLeftRight, Building2, ChevronDown, LogOut } from "lucide-react";
import { useIntl } from "react-intl";

import { cn } from "@/lib/utils";

// The "Log out" dropdown in the top bar: change company (back to the company list — the only way
// to switch) or log out of PAKO entirely.
export function AccountMenu({
  email,
  companyName,
  onChangeCompany,
  onLogout,
}: {
  email: string | undefined;
  companyName: string | undefined;
  onChangeCompany: () => void;
  onLogout: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [open, setOpen] = useState(false);
  const itemsRef = useRef<HTMLDivElement>(null);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  // Arrow keys move between the items, like a native menu.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(itemsRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  const item = "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={email ? `${t("common.logOut")} — ${email}` : t("common.logOut")}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="size-4" />
          {t("common.logOut")}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            itemsRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
          }}
        >
          <div className="border-b px-2 pb-2 pt-1.5">
            {email && <div className="truncate text-sm font-medium">{email}</div>}
            {companyName && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="size-3" />
                <span className="truncate">{companyName}</span>
              </div>
            )}
          </div>
          <div ref={itemsRef} role="menu" aria-label={t("common.logOut")} className="pt-1" onKeyDown={onKeyDown}>
            <button type="button" role="menuitem" className={item} onClick={() => choose(onChangeCompany)}>
              <ArrowLeftRight className="size-4 text-muted-foreground" />
              <span className="flex flex-col">
                <span>{t("lobby.exit")}</span>
                <span className="text-xs text-muted-foreground">{t("lobby.exit.hint")}</span>
              </span>
            </button>
            <div className="my-1 h-px bg-border" role="separator" />
            <button type="button" role="menuitem" className={cn(item, "text-destructive hover:text-destructive focus-visible:text-destructive")} onClick={() => choose(onLogout)}>
              <LogOut className="size-4" />
              {t("lobby.logoutCompletely")}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
