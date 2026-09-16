import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { navItems } from "@/config/nav";
import { useTabs, type ResolvedTab } from "@/context/TabsContext";
import { cn } from "@/lib/utils";

function tabTitle(tab: ResolvedTab, intl: ReturnType<typeof useIntl>): string {
  if (tab.titleOverride) return tab.titleOverride;
  if (tab.kind === "instance" && tab.fallbackTitleKey) return intl.formatMessage({ id: tab.fallbackTitleKey });
  if (tab.titleKey) return intl.formatMessage({ id: tab.titleKey });
  return tab.path;
}

export function TabStrip() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { tabs, activeTabId, closeTab, focusTab } = useTabs();
  // "+" at the end of the strip: SHELL_SPEC §2 doesn't say what it opens. Simplest reasonable
  // behaviour — a quick-open search over every destination — chosen over e.g. a blank new-tab
  // page, since there is no "blank tab" concept in this app (every tab is a real route).
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickOpenAnchor, setQuickOpenAnchor] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const quickOpenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!quickOpen) return;
    function handleClick(event: MouseEvent) {
      if (quickOpenRef.current && !quickOpenRef.current.contains(event.target as Node)) {
        setQuickOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [quickOpen]);

  const matches = query.trim()
    ? navItems.filter((item) => intl.formatMessage({ id: item.titleKey }).toLowerCase().includes(query.trim().toLowerCase()))
    : navItems;

  if (tabs.length === 0 && !quickOpen) return null;

  return (
    // Overflow behaviour: simplest version is a horizontal scroll on the strip itself.
    // TODO: SHELL_SPEC §2 leaves this an open decision — the alternative is a "+N" overflow
    // menu once the strip is full, which would need measuring available width instead of
    // relying on native scroll. Revisit if accountants routinely keep >10-12 tabs open.
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-secondary">
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const Icon = tab.icon;
          const title = tabTitle(tab, intl);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => focusTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  closeTab(tab.id);
                }
              }}
              className={cn(
                "group flex h-9 max-w-52 min-w-32 shrink-0 items-center gap-1.5 border-r px-2.5 text-[12.5px]",
                isActive
                  ? "bg-card font-medium text-foreground shadow-[inset_0_2px_0_var(--primary)]"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
              title={title}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{title}</span>
              {tab.dirty && (
                <span
                  aria-label={intl.formatMessage({ id: "shell.tabs.unsaved" })}
                  className="size-1.5 shrink-0 rounded-full bg-warning-foreground"
                />
              )}
              <span
                role="button"
                tabIndex={-1}
                aria-label={intl.formatMessage({ id: "shell.tabs.close" })}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
              >
                <X className="size-3" />
              </span>
            </button>
          );
        })}
      </div>
      <div ref={quickOpenRef} className="shrink-0">
        <button
          type="button"
          onClick={(event) => {
            if (quickOpen) {
              setQuickOpen(false);
              return;
            }
            setQuickOpenAnchor(event.currentTarget.getBoundingClientRect());
            setQuickOpen(true);
          }}
          aria-label={intl.formatMessage({ id: "shell.tabs.new" })}
          title={intl.formatMessage({ id: "shell.tabs.new" })}
          className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-card/60 hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
        {quickOpen && quickOpenAnchor && (
          // Fixed, not absolute — the strip itself scrolls horizontally, which would clip an
          // absolutely-positioned popover the same way it clips overflow generally.
          <div
            style={{ position: "fixed", top: quickOpenAnchor.bottom + 2, left: Math.max(8, quickOpenAnchor.right - 256) }}
            className="z-30 w-64 rounded-md border bg-card p-1.5 shadow-lg"
          >
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={intl.formatMessage({ id: "sidebar.filterPlaceholder" })}
              className="mb-1 h-7 w-full rounded border bg-background px-2 text-[12.5px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="max-h-72 overflow-y-auto">
              {matches.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    navigate(item.path);
                    setQuickOpen(false);
                    setQuickOpenAnchor(null);
                    setQuery("");
                  }}
                  className="flex h-7 w-full items-center rounded px-2 text-left text-[12.5px] hover:bg-accent hover:text-accent-foreground"
                >
                  {intl.formatMessage({ id: item.titleKey })}
                </button>
              ))}
              {matches.length === 0 && (
                <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
                  {intl.formatMessage({ id: "sidebar.noResults" })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
