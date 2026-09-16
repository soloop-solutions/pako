import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, MoreHorizontal, Search, Star, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useLocation } from "react-router-dom";

import { bottomNavItems, favouriteActions, navCategories, topNavItems, type NavItem } from "@/config/nav";
import { useAuth } from "@/context/AuthContext";
import {
  emptyPrefs,
  loadSidebarPrefs,
  saveSidebarPrefs,
  type CategoryPrefs,
  type SidebarPrefs,
} from "@/lib/sidebar-prefs";
import { cn } from "@/lib/utils";

const allItemsByPath = new Map<string, NavItem>(
  [...topNavItems, ...navCategories.flatMap((c) => c.items), ...bottomNavItems].map((item) => [item.path, item]),
);

function buildSavedViewHref(item: NavItem, filters: Record<string, string>): string {
  if (!item.gridId || Object.keys(filters).length === 0) return item.path;
  const params = new URLSearchParams();
  for (const [column, value] of Object.entries(filters)) {
    params.set(`${item.gridId}.f.${column}`, value);
  }
  return `${item.path}?${params.toString()}`;
}

export function Sidebar() {
  const intl = useIntl();
  const location = useLocation();
  const { auth } = useAuth();
  const userId = auth?.userId ?? null;

  const [prefs, setPrefs] = useState<SidebarPrefs>(() => emptyPrefs());
  const loadedUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setPrefs(emptyPrefs());
      loadedUserRef.current = null;
      return;
    }
    if (loadedUserRef.current === userId) return;
    loadedUserRef.current = userId;
    setPrefs(loadSidebarPrefs(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    saveSidebarPrefs(userId, prefs);
  }, [userId, prefs]);

  const [query, setQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [openSavedViewFor, setOpenSavedViewFor] = useState<string | null>(null);
  const [customizeCategoryId, setCustomizeCategoryId] = useState<string | null>(null);
  const [customizeAnchor, setCustomizeAnchor] = useState<DOMRect | null>(null);

  function isActive(path: string): boolean {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  }

  function toggleFavourite(path: string) {
    setPrefs((prev) => {
      const isFav = prev.favourites.includes(path);
      return {
        ...prev,
        favourites: isFav ? prev.favourites.filter((id) => id !== path) : [...prev.favourites, path],
      };
    });
  }

  function toggleHidden(categoryId: string, path: string) {
    setPrefs((prev) => {
      const cat = prev.categories[categoryId];
      if (!cat) return prev;
      const hidden = cat.hidden.includes(path) ? cat.hidden.filter((id) => id !== path) : [...cat.hidden, path];
      return { ...prev, categories: { ...prev.categories, [categoryId]: { ...cat, hidden } } };
    });
  }

  function moveItem(categoryId: string, path: string, direction: -1 | 1) {
    setPrefs((prev) => {
      const cat = prev.categories[categoryId];
      if (!cat) return prev;
      const index = cat.order.indexOf(path);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= cat.order.length) return prev;
      const order = [...cat.order];
      [order[index], order[targetIndex]] = [order[targetIndex], order[index]];
      return { ...prev, categories: { ...prev.categories, [categoryId]: { ...cat, order } } };
    });
  }

  function label(item: NavItem): string {
    return intl.formatMessage({ id: item.titleKey });
  }

  const searchQuery = query.trim().toLowerCase();
  const searchResults = searchQuery
    ? [...allItemsByPath.values()].filter((item) => label(item).toLowerCase().includes(searchQuery))
    : null;

  return (
    <aside className="flex w-[236px] shrink-0 flex-col overflow-y-auto border-r bg-card">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <span className="text-base font-semibold">PAKO</span>
      </div>

      <div className="px-2.5 pt-2.5 pb-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={intl.formatMessage({ id: "sidebar.filterPlaceholder" })}
            aria-label={intl.formatMessage({ id: "sidebar.filterPlaceholder" })}
            className="h-7 w-full rounded-md border bg-background pl-6 pr-2 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      {searchResults ? (
        <div className="flex flex-col pb-2">
          {searchResults.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">{intl.formatMessage({ id: "sidebar.noResults" })}</p>
          ) : (
            searchResults.map((item) => (
              <SidebarLink key={item.path} item={item} label={label(item)} active={isActive(item.path)} />
            ))
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col pb-1">
            {topNavItems.map((item) => (
              <SidebarLink key={item.path} item={item} label={label(item)} active={isActive(item.path)} />
            ))}
          </div>

          <div className="border-t" />

          <FavouritesSection prefs={prefs} intl={intl} isActive={isActive} onUnstar={toggleFavourite} />

          {navCategories.map((category) => {
            const catPrefs: CategoryPrefs = prefs.categories[category.id] ?? { order: category.items.map((i) => i.path), hidden: [] };
            const itemsById = new Map(category.items.map((i) => [i.path, i]));
            const orderedItems = catPrefs.order.map((id) => itemsById.get(id)).filter((i): i is NavItem => !!i);
            const visibleItems = orderedItems.filter((i) => !catPrefs.hidden.includes(i.path));
            const hiddenItems = orderedItems.filter((i) => catPrefs.hidden.includes(i.path));
            const expanded = !!expandedCategories[category.id];
            const shown = expanded ? orderedItems : visibleItems;

            return (
              <div key={category.id}>
                <div className="border-t" />
                <div className="relative flex h-[22px] items-center px-3">
                  <span className="text-[10.5px] font-bold tracking-[0.09em] text-muted-foreground uppercase">
                    {intl.formatMessage({ id: category.labelKey })}
                  </span>
                  <button
                    type="button"
                    aria-label={intl.formatMessage({ id: "sidebar.customize" }, { category: intl.formatMessage({ id: category.labelKey }) })}
                    onClick={(event) => {
                      if (customizeCategoryId === category.id) {
                        setCustomizeCategoryId(null);
                        setCustomizeAnchor(null);
                        return;
                      }
                      setCustomizeAnchor(event.currentTarget.getBoundingClientRect());
                      setCustomizeCategoryId(category.id);
                    }}
                    className="ml-auto text-muted-foreground hover:text-foreground"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                  {customizeCategoryId === category.id && customizeAnchor && (
                    <CategoryCustomizePanel
                      category={category}
                      catPrefs={catPrefs}
                      favourites={prefs.favourites}
                      anchor={customizeAnchor}
                      onToggleHidden={(path) => toggleHidden(category.id, path)}
                      onMove={(path, direction) => moveItem(category.id, path, direction)}
                      onToggleFavourite={toggleFavourite}
                      onClose={() => {
                        setCustomizeCategoryId(null);
                        setCustomizeAnchor(null);
                      }}
                    />
                  )}
                </div>

                {shown.map((item) => (
                  <div key={item.path}>
                    <SidebarLink
                      item={item}
                      label={label(item)}
                      active={isActive(item.path)}
                      hasSavedViews={!!item.savedViews?.length}
                      savedViewsOpen={openSavedViewFor === item.path}
                      onToggleSavedViews={() => setOpenSavedViewFor(openSavedViewFor === item.path ? null : item.path)}
                    />
                    {openSavedViewFor === item.path && item.savedViews && (
                      <div className="border-t border-b bg-secondary/40 py-0.5">
                        {item.savedViews.map((view) => (
                          <Link
                            key={view.id}
                            to={buildSavedViewHref(item, view.filters)}
                            onClick={() => setOpenSavedViewFor(null)}
                            className="flex h-6 items-center pr-3 pl-[34px] text-[12px] hover:bg-accent hover:text-accent-foreground"
                          >
                            {intl.formatMessage({ id: view.labelKey })}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {hiddenItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedCategories((prev) => ({ ...prev, [category.id]: !expanded }))}
                    className="flex h-6 w-full items-center pr-3 pl-5 text-left text-[11.5px] text-muted-foreground hover:text-foreground"
                  >
                    {expanded
                      ? intl.formatMessage({ id: "sidebar.showLess" })
                      : intl.formatMessage({ id: "sidebar.showMore" }, { count: hiddenItems.length })}
                  </button>
                )}
              </div>
            );
          })}

          <div className="border-t" />
          <div className="flex flex-col py-1 pb-2">
            {bottomNavItems.map((item) => (
              <SidebarLink key={item.path} item={item} label={label(item)} active={isActive(item.path)} />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function SidebarLink({
  item,
  label,
  active,
  hasSavedViews = false,
  savedViewsOpen = false,
  onToggleSavedViews,
}: {
  item: NavItem;
  label: string;
  active: boolean;
  hasSavedViews?: boolean;
  savedViewsOpen?: boolean;
  onToggleSavedViews?: () => void;
}) {
  const intl = useIntl();
  return (
    <div
      className={cn(
        "flex h-[26px] items-center pr-3 pl-5 text-[12.5px]",
        active
          ? "bg-row-selected font-semibold text-accent-foreground shadow-[inset_2px_0_0_var(--primary)]"
          : "text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Link to={item.path} className="min-w-0 flex-1 truncate">
        {label}
      </Link>
      {hasSavedViews && (
        <button
          type="button"
          onClick={onToggleSavedViews}
          aria-label={intl.formatMessage({ id: savedViewsOpen ? "sidebar.savedViews.collapse" : "sidebar.savedViews.expand" })}
          className="ml-1 shrink-0 text-muted-foreground hover:text-foreground"
        >
          {savedViewsOpen ? <ChevronUp className="size-2.5" /> : <ChevronDown className="size-2.5" />}
        </button>
      )}
    </div>
  );
}

function FavouritesSection({
  prefs,
  intl,
  isActive,
  onUnstar,
}: {
  prefs: SidebarPrefs;
  intl: ReturnType<typeof useIntl>;
  isActive: (path: string) => boolean;
  onUnstar: (path: string) => void;
}) {
  const starredItems = prefs.favourites.map((path) => allItemsByPath.get(path)).filter((i): i is NavItem => !!i);

  return (
    <div>
      <div className="flex h-[22px] items-center gap-1 px-3">
        <Star className="size-2.5 fill-warning-foreground text-warning-foreground" />
        <span className="text-[10.5px] font-bold tracking-[0.09em] text-muted-foreground uppercase">
          {intl.formatMessage({ id: "sidebar.category.favourites" })}
        </span>
      </div>
      {favouriteActions.map((action) => (
        <Link
          key={action.id}
          to={action.path}
          className="flex h-[26px] items-center pr-3 pl-5 text-[12.5px] font-semibold text-primary hover:bg-accent"
        >
          {intl.formatMessage({ id: action.labelKey })}
        </Link>
      ))}
      {starredItems.map((item) => (
        <div
          key={item.path}
          className={cn(
            "group flex h-[26px] items-center pr-1 pl-5 text-[12.5px]",
            isActive(item.path)
              ? "bg-row-selected font-semibold text-accent-foreground shadow-[inset_2px_0_0_var(--primary)]"
              : "text-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Link to={item.path} className="min-w-0 flex-1 truncate">
            {intl.formatMessage({ id: item.titleKey })}
          </Link>
          <button
            type="button"
            onClick={() => onUnstar(item.path)}
            aria-label={intl.formatMessage({ id: "sidebar.removeFavourite" })}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function CategoryCustomizePanel({
  category,
  catPrefs,
  favourites,
  anchor,
  onToggleHidden,
  onMove,
  onToggleFavourite,
  onClose,
}: {
  category: { id: string; labelKey: string; items: NavItem[] };
  catPrefs: CategoryPrefs;
  favourites: string[];
  anchor: DOMRect;
  onToggleHidden: (path: string) => void;
  onMove: (path: string, direction: -1 | 1) => void;
  onToggleFavourite: (path: string) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const panelRef = useRef<HTMLDivElement>(null);
  const itemsById = new Map(category.items.map((i) => [i.path, i]));
  const orderedItems = catPrefs.order.map((id) => itemsById.get(id)).filter((i): i is NavItem => !!i);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Fixed (not absolute) so the panel escapes the sidebar's own scroll container — an
  // absolutely-positioned panel gets clipped by the sidebar's `overflow-y-auto`.
  const panelWidth = 288;
  const left = Math.max(8, Math.min(anchor.right - panelWidth, window.innerWidth - panelWidth - 8));

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", top: anchor.bottom + 4, left }}
      className="z-30 w-72 rounded-md border bg-card shadow-lg"
    >
      <div className="border-b px-3.5 py-2.5">
        <p className="text-[13px] font-bold">
          {intl.formatMessage({ id: "sidebar.customizeTitle" }, { category: intl.formatMessage({ id: category.labelKey }) })}
        </p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{intl.formatMessage({ id: "sidebar.customizeSubtitle" })}</p>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {orderedItems.map((item, index) => {
          const hidden = catPrefs.hidden.includes(item.path);
          const isFavourite = favourites.includes(item.path);
          return (
            <div
              key={item.path}
              className={cn("flex items-center gap-2 border-b px-3.5 py-1.5 text-[12.5px] last:border-b-0", hidden && "text-muted-foreground")}
            >
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMove(item.path, -1)}
                  aria-label={intl.formatMessage({ id: "sidebar.moveUp" })}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={index === orderedItems.length - 1}
                  onClick={() => onMove(item.path, 1)}
                  aria-label={intl.formatMessage({ id: "sidebar.moveDown" })}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="size-3" />
                </button>
              </div>
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={() => onToggleHidden(item.path)}
                  aria-label={intl.formatMessage({ id: "sidebar.toggleVisible" })}
                />
                <span className="truncate">{intl.formatMessage({ id: item.titleKey })}</span>
              </label>
              <button
                type="button"
                onClick={() => onToggleFavourite(item.path)}
                aria-label={intl.formatMessage({ id: "sidebar.toggleFavourite" })}
                className={cn("shrink-0", isFavourite ? "text-warning-foreground" : "text-muted-foreground/40 hover:text-muted-foreground")}
              >
                <Star className={cn("size-3", isFavourite && "fill-current")} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t bg-secondary/40 px-3.5 py-2">
        <span className="text-[11px] text-muted-foreground">{intl.formatMessage({ id: "sidebar.favouriteLegend" })}</span>
        <button type="button" onClick={onClose} className="ml-auto rounded-md border bg-background px-2.5 py-1 text-[12px] hover:bg-accent">
          {intl.formatMessage({ id: "sidebar.done" })}
        </button>
      </div>
    </div>
  );
}
