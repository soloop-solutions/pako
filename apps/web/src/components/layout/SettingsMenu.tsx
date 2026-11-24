import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import type { NavItem } from "@/config/nav";
import { useTheme } from "@/context/ThemeContext";
import { useLocale } from "@/i18n/useLocale";
import { cn } from "@/lib/utils";

export interface SettingsMenuSection {
  /** Message id of the section heading; none for the first, unnamed section. */
  labelKey?: string;
  items: NavItem[];
}

// User request 2026-11-24: everything about configuration lives in one menu at the bottom of the
// sidebar — language, light/dark, and the settings, company and administration pages — instead of
// a top bar and the end of the page list.
export function SettingsMenu({ sections, activePath }: { sections: SettingsMenuSection[]; activePath: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [open, setOpen] = useState(false);
  const active = sections.some((s) => s.items.some((i) => activePath === i.path || activePath.startsWith(`${i.path}/`)));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("settingsMenu.title")}
          title={t("settingsMenu.title")}
          data-testid="settings-menu"
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            (open || active) && "bg-accent text-foreground",
          )}
        >
          <SettingsIcon className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <p className="px-1 pb-2 text-xs font-semibold">{t("settingsMenu.title")}</p>
          <Preferences />

          {sections
            .filter((section) => section.items.length > 0)
            .map((section, index) => (
              <div key={section.labelKey ?? index} className="flex flex-col pt-1.5">
                {section.labelKey && (
                  <span className="px-1 pt-1 pb-0.5 text-[11px] text-muted-foreground">{t(section.labelKey)}</span>
                )}
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const selected = activePath === item.path || activePath.startsWith(`${item.path}/`);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex h-7 items-center gap-2 rounded-sm px-1.5 text-[12.5px] hover:bg-accent hover:text-accent-foreground",
                        selected && "bg-accent font-medium",
                      )}
                    >
                      <Icon className="size-3.5 text-muted-foreground" />
                      {t(item.titleKey)}
                    </Link>
                  );
                })}
              </div>
            ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const segment = (selected: boolean) =>
  cn(
    "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm text-xs",
    selected ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
  );

// Language and light/dark, rendered only while the menu is open.
function Preferences() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { theme, toggle } = useTheme();
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex flex-col gap-2 border-b px-1 pb-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">{t("language.label")}</span>
        <div className="flex gap-0.5 rounded-md bg-muted p-0.5" role="radiogroup" aria-label={t("language.label")}>
          {(["sq", "en"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={locale === value}
              className={segment(locale === value)}
              onClick={() => setLocale(value)}
            >
              {t(value === "sq" ? "language.albanian" : "language.english")}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">{t("settingsMenu.appearance")}</span>
        <div className="flex gap-0.5 rounded-md bg-muted p-0.5" role="radiogroup" aria-label={t("settingsMenu.appearance")}>
          {(["light", "dark"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              className={segment(theme === value)}
              onClick={() => {
                if (theme !== value) toggle();
              }}
            >
              {value === "light" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              {t(value === "light" ? "common.theme.light" : "common.theme.dark")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
