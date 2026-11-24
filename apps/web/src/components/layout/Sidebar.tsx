import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ChevronUp, MoreHorizontal, PanelLeftClose, Search, Star, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useLocation } from "react-router-dom";

import { navSearchTerms } from "@/config/navSearchTerms";
import { matchesSearch } from "@/lib/searchMatch";
import { useAllSavedListViews } from "@/lib/list-views";

import { bottomNavItems, favouriteActions, navCategories as defaultNavCategories, topNavItems, type NavItem, type NavModule } from "@/config/nav";
import { applyNavLayout, navLayoutFor, navLayoutScope } from "@/config/navLayout";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";
import { useFeatures } from "@/hooks/useFeatures";
import { useMyAccess } from "@/hooks/useMyAccess";
import { MENU_GROUP_PREFIX, menuGroupCategories } from "@/config/navGroups";
import { SavedViewCount } from "@/components/layout/SavedViewCount";
import {
  emptyPrefs,
  getTopNavPaths,
  loadSidebarFocus,
  loadSidebarPrefs,
  recordNavigation,
  saveSidebarFocus,
  saveSidebarPrefs,
  type CategoryPrefs,
  type SidebarPrefs,
} from "@/lib/sidebar-prefs";
import { BrandMark } from "@/components/auth/AuthLayout";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { OPEN_GLOBAL_SEARCH_EVENT } from "@/components/layout/GlobalSearch";
import { SettingsMenu, type SettingsMenuSection } from "@/components/layout/SettingsMenu";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

const allItemsByPath = new Map<string, NavItem>(
  [...topNavItems, ...defaultNavCategories.flatMap((c) => c.items), ...bottomNavItems].map((item) => [item.path, item]),
);

// HR module: the permission module each nav path needs (item override, else its category's).
// Paths outside any module-gated category resolve to undefined = always visible.
const moduleByPath = new Map<string, NavModule | undefined>([
  ...defaultNavCategories.flatMap((c) => c.items.map((item) => [item.path, item.module ?? c.module] as const)),
  ...bottomNavItems.filter((i) => i.module).map((i) => [i.path, i.module] as const),
]);

// Business types: the vertical pack each nav path belongs to (undefined = every company).
const featureByPath = new Map<string, NavItem["feature"]>(
  [...allItemsByPath.values()].filter((item) => item.feature).map((item) => [item.path, item.feature] as const),
);

function buildSavedViewHref(item: NavItem, filters: Record<string, string>): string {
  if (!item.gridId || Object.keys(filters).length === 0) return item.path;
  const params = new URLSearchParams();
  for (const [column, value] of Object.entries(filters)) {
    params.set(`${item.gridId}.f.${column}`, value);
  }
  return `${item.path}?${params.toString()}`;
}

// The settings, company and administration pages sit in the footer's settings menu (user request
// 2026-11-24), not in the page list.
const SETTINGS_CATEGORY_ID = "administration";
const settingsPaths = ["/settings", "/company-profile", "/companies"];

export function Sidebar({
  onHide,
  onChangeCompany,
  onLogout,
}: {
  /** Desktop: fold the sidebar away (the tab strip shows a button to bring it back). */
  onHide?: () => void;
  onChangeCompany?: () => void;
  onLogout?: () => void;
} = {}) {
  const intl = useIntl();
  const userViews = useAllSavedListViews();
  const location = useLocation();
  const { auth } = useAuth();
  const userId = auth?.userId ?? null;
  const { access, canSee } = useMyAccess();
  const { hasFeature, businessType } = useFeatures();
  const { activeCompany } = useCompany();
  const isFirmClient = !!activeCompany?.firmId;
  const layout = useMemo(() => navLayoutFor(businessType, isFirmClient), [businessType, isFirmClient]);
  const layoutScope = navLayoutScope(businessType, isFirmClient);
  const layoutCategories = useMemo(
    () => applyNavLayout(defaultNavCategories, layout).filter((c) => c.id !== SETTINGS_CATEGORY_ID),
    [layout],
  );
  // Client request 2026-11-24: the user's role menu groups ("My work") come first, made of the
  // same pages; the usual sections follow unchanged.
  const menuGroups = access?.menuGroups;
  const groupCategories = useMemo(() => menuGroupCategories(menuGroups, allItemsByPath), [menuGroups]);
  const navCategories = useMemo(() => [...groupCategories, ...layoutCategories], [groupCategories, layoutCategories]);
  const layoutTopItems = useMemo(
    () => (layout.topPaths ?? []).map((path) => allItemsByPath.get(path)).filter((item): item is NavItem => !!item),
    [layout],
  );

  // Display only — hides what the user's department can't open, and the pages of vertical packs
  // the company doesn't use; the API enforces both regardless. A category left empty is hidden.
  function isAllowed(path: string): boolean {
    const module = moduleByPath.get(path);
    const feature = featureByPath.get(path);
    return (!module || canSee(module)) && (!feature || hasFeature(feature));
  }

  const settingsSections: SettingsMenuSection[] = [
    { items: settingsPaths.map((path) => allItemsByPath.get(path)).filter((i): i is NavItem => !!i && isAllowed(i.path)) },
    {
      labelKey: "sidebar.category.administration",
      items: (defaultNavCategories.find((c) => c.id === SETTINGS_CATEGORY_ID)?.items ?? []).filter((i) => isAllowed(i.path)),
    },
  ];

  // `userId` and `prefs` are kept in one state object, set together, so a user switch is atomic
  // — see the matching comment in TabsContext.tsx for why a separate ref-tracked "loaded key"
  // plus a bare prefs state briefly writes the outgoing user's prefs under the incoming user's
  // storage key during the switch.
  const [prefsState, setPrefsState] = useState<{ userId: string | null; scope: string; prefs: SidebarPrefs }>({
    userId: null,
    scope: "",
    prefs: emptyPrefs(),
  });

  useEffect(() => {
    if (!userId) {
      setPrefsState((prev) => (prev.userId === null ? prev : { userId: null, scope: "", prefs: emptyPrefs(navCategories) }));
      return;
    }
    setPrefsState((prev) =>
      prev.userId === userId && prev.scope === layoutScope
        ? prev
        : { userId, scope: layoutScope, prefs: loadSidebarPrefs(userId, navCategories, layoutScope) },
    );
  }, [userId, layoutScope, navCategories]);

  useEffect(() => {
    if (!userId || prefsState.userId !== userId || prefsState.scope !== layoutScope) return;
    saveSidebarPrefs(userId, prefsState.prefs, layoutScope);
  }, [userId, layoutScope, prefsState]);

  const prefs = prefsState.prefs;
  const setPrefs = (updater: (prev: SidebarPrefs) => SidebarPrefs) =>
    setPrefsState((prev) => ({ ...prev, prefs: updater(prev.prefs) }));

  // Record every navigation so the "Suggested" section can surface most-visited pages.
  // We track the base pathname (no query string) and only paths that correspond to a known nav
  // item, so random sub-routes don't pollute the frequency map.
  const prevPathRef = useRef<string | null>(null);
  useEffect(() => {
    const basePath = location.pathname;
    if (!userId || basePath === prevPathRef.current) return;
    prevPathRef.current = basePath;
    if (allItemsByPath.has(basePath)) {
      recordNavigation(userId, basePath);
    }
  }, [location.pathname, userId]);

  const [query, setQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [manuallyOpen, setManuallyOpen] = useState<Record<string, boolean>>({});
  const [focus, setFocusState] = useState(() => loadSidebarFocus(userId));
  useEffect(() => {
    setFocusState(loadSidebarFocus(userId));
  }, [userId]);
  const [openSavedViewFor, setOpenSavedViewFor] = useState<string | null>(null);
  const [customizeCategoryId, setCustomizeCategoryId] = useState<string | null>(null);
  const [customizeAnchor, setCustomizeAnchor] = useState<DOMRect | null>(null);

  function isActive(path: string): boolean {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  }

  const activeCategoryId = navCategories.find((c) => c.items.some((i) => isAllowed(i.path) && isActive(i.path)))?.id;

  function toggleFavourite(path: string) {
    setPrefs((prev) => {
      const isFav = prev.favourites.includes(path);
      return {
        ...prev,
        favourites: isFav ? prev.favourites.filter((id) => id !== path) : [...prev.favourites, path],
      };
    });
  }

  function toggleCollapsed(categoryId: string) {
    setPrefs((prev) => {
      const current = prev.collapsed ?? [];
      return {
        ...prev,
        collapsed: current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
      };
    });
  }

  function setFocus(focus: boolean) {
    setManuallyOpen({});
    setFocusState(focus);
    saveSidebarFocus(userId, focus);
    setPrefs((prev) => ({ ...prev, collapsed: [] }));
  }

  // A section that arrived after the prefs were loaded (a role group) starts from its defaults.
  function categoryPrefs(prev: SidebarPrefs, categoryId: string): CategoryPrefs | undefined {
    const category = navCategories.find((c) => c.id === categoryId);
    return prev.categories[categoryId] ?? (category ? { order: category.items.map((i) => i.path), hidden: [] } : undefined);
  }

  function toggleHidden(categoryId: string, path: string) {
    setPrefs((prev) => {
      const cat = categoryPrefs(prev, categoryId);
      if (!cat) return prev;
      const hidden = cat.hidden.includes(path) ? cat.hidden.filter((id) => id !== path) : [...cat.hidden, path];
      return { ...prev, categories: { ...prev.categories, [categoryId]: { ...cat, hidden } } };
    });
  }

  function moveItem(categoryId: string, path: string, direction: -1 | 1) {
    setPrefs((prev) => {
      const cat = categoryPrefs(prev, categoryId);
      if (!cat) return prev;
      // Pages added to the section after its order was saved join the end before moving.
      const allPaths = navCategories.find((c) => c.id === categoryId)?.items.map((i) => i.path) ?? [];
      const order = [...cat.order, ...allPaths.filter((p) => !cat.order.includes(p))];
      const index = order.indexOf(path);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= order.length) return prev;
      [order[index], order[targetIndex]] = [order[targetIndex], order[index]];
      return { ...prev, categories: { ...prev.categories, [categoryId]: { ...cat, order } } };
    });
  }

  function label(item: NavItem): string {
    return intl.formatMessage({ id: item.titleKey });
  }

  const searchQuery = query.trim().toLowerCase();
  const searchResults = searchQuery
    ? [...allItemsByPath.values()]
        .filter((item) => isAllowed(item.path))
        .map((item) => {
          if (matchesSearch(searchQuery, label(item))) return { item, rank: 0 };
          const detail = [intl.formatMessage({ id: item.descriptionKey }), navSearchTerms[item.path]];
          return matchesSearch(searchQuery, label(item), ...detail) ? { item, rank: 1 } : null;
        })
        .filter((match): match is { item: NavItem; rank: number } => match !== null)
        .sort((a, b) => a.rank - b.rank)
        .map((match) => match.item)
    : null;

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r bg-card lg:w-[236px]">
      <div className="flex shrink-0 flex-col gap-1.5 border-b px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          <BrandMark className="size-5 text-primary" />
          <span className="text-sm font-semibold">PAKO</span>
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              className="ml-auto hidden rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground lg:inline-flex"
              aria-label={intl.formatMessage({ id: "sidebar.hideSidebar" })}
              title={intl.formatMessage({ id: "sidebar.hideSidebar" })}
            >
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>
        {activeCompany && (
          <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1" data-testid="active-company" title={activeCompany.name}>
            <Building2 className="size-3.5 shrink-0 text-primary" />
            <span className="truncate text-xs font-semibold text-primary">{activeCompany.name}</span>
            {!activeCompany.isVatRegistered && (
              <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {intl.formatMessage({ id: "header.vatBadge" })}
              </span>
            )}
          </div>
        )}
      </div>


      <div className="flex items-center gap-1 px-2.5 pt-2.5 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={intl.formatMessage({ id: "sidebar.filterPlaceholder" })}
            aria-label={intl.formatMessage({ id: "sidebar.filterPlaceholder" })}
            className="h-7 w-full rounded-md border bg-background pl-6 pr-2 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        {/* Focus mode: only the section of the open page stays expanded. */}
        <button
          type="button"
          onClick={() => setFocus(!focus)}
          aria-label={intl.formatMessage({ id: focus ? "sidebar.expandAll" : "sidebar.collapseAll" })}
          title={intl.formatMessage({ id: focus ? "sidebar.expandAll" : "sidebar.collapseAll" })}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {focus ? <ChevronsUpDown className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-brand">
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
          <div className="flex flex-col">
            {[...topNavItems, ...layoutTopItems].filter((item) => isAllowed(item.path)).map((item) => (
              <SidebarLink key={item.path} item={item} label={label(item)} active={isActive(item.path)} />
            ))}
          </div>

          {/* TASK-018: hide Favourites/Suggested when the sidebar has fewer than 10 accessible items. */}
          {navCategories.reduce((n, c) => n + c.items.filter((i) => isAllowed(i.path)).length, 0) >= 10 && (
            <FavouritesSection prefs={prefs} intl={intl} isActive={isActive} isAllowed={isAllowed} onUnstar={toggleFavourite} onPin={toggleFavourite} userId={userId} />
          )}

          {navCategories.map((category, index) => {
            const allowedItems = category.items.filter((i) => isAllowed(i.path));
            if (allowedItems.length === 0) return null;
            const firstGroup = index === 0 && category.id.startsWith(MENU_GROUP_PREFIX);
            const firstSection = groupCategories.length > 0 && index === groupCategories.length;
            const catPrefs: CategoryPrefs = prefs.categories[category.id] ?? { order: category.items.map((i) => i.path), hidden: [] };
            const itemsById = new Map(allowedItems.map((i) => [i.path, i]));
            // Saved order first; pages added to the section since it was saved follow, so a customised
            // section never hides a new page.
            const orderedItems = [
              ...catPrefs.order.map((id) => itemsById.get(id)).filter((i): i is NavItem => !!i),
              ...allowedItems.filter((i) => !catPrefs.order.includes(i.path)),
            ];
            const visibleItems = orderedItems.filter((i) => !catPrefs.hidden.includes(i.path));
            const hiddenItems = orderedItems.filter((i) => catPrefs.hidden.includes(i.path));
            const expanded = !!expandedCategories[category.id];
            const folded = focus ? category.id !== activeCategoryId && !manuallyOpen[category.id] : (prefs.collapsed ?? []).includes(category.id);
            const shown = folded ? orderedItems.filter((i) => isActive(i.path)) : expanded ? orderedItems : visibleItems;

            return (
              <div key={category.id}>
                {/* Role groups sit under a "My work" heading, apart from the usual sections. */}
                {firstGroup && (
                  <p className="px-4 pt-3 text-[10.5px] font-semibold tracking-[0.08em] text-nav-active-foreground uppercase" data-testid="sidebar-my-work">
                    {intl.formatMessage({ id: "sidebar.myWork" })}
                  </p>
                )}
                {firstSection && <div className="mx-4 mt-3 border-t" />}
                <div className="group/section relative mt-3 mb-0.5 flex h-6 items-center pr-2 pl-4">
                  <button
                    type="button"
                    aria-expanded={!folded}
                    aria-label={intl.formatMessage({ id: folded ? "sidebar.expandSection" : "sidebar.collapseSection" }, { category: intl.formatMessage({ id: category.labelKey }) })}
                    onClick={() => (focus ? setManuallyOpen((prev) => ({ ...prev, [category.id]: !prev[category.id] })) : toggleCollapsed(category.id))}
                    className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <span className="truncate text-[10.5px] font-semibold tracking-[0.08em] uppercase">
                      {intl.formatMessage({ id: category.labelKey })}
                    </span>
                    {folded ? <ChevronRight className="size-3 shrink-0 opacity-60" /> : <ChevronDown className="size-3 shrink-0 opacity-60" />}
                  </button>
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
                    className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 group-hover/section:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                  {customizeCategoryId === category.id && customizeAnchor && (
                    <CategoryCustomizePanel
                      category={{ ...category, items: allowedItems }}
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
                      hasSavedViews={!!item.savedViews?.length || !!(item.gridId && userViews.views[item.gridId]?.length)}
                      savedViewsOpen={openSavedViewFor === item.path}
                      onToggleSavedViews={() => setOpenSavedViewFor(openSavedViewFor === item.path ? null : item.path)}
                    />
                    {openSavedViewFor === item.path && (
                      <div className="mx-2 my-0.5 ml-[30px] border-l py-0.5">
                        {(item.savedViews ?? []).map((view) => (
                          <Link
                            key={view.id}
                            to={buildSavedViewHref(item, view.filters)}
                            onClick={() => setOpenSavedViewFor(null)}
                            className="flex h-6 items-center rounded-r-md pr-2 pl-3 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            {intl.formatMessage({ id: view.labelKey })}
                            {item.savedViewCounts && <SavedViewCount source={item.savedViewCounts} viewId={view.id} />}
                          </Link>
                        ))}
                        {/* Views the user saved from the list ribbon (lib/list-views.ts). */}
                        {item.gridId && (userViews.views[item.gridId] ?? []).map((view) => (
                          <div key={view.id} className="group flex h-6 items-center rounded-r-md pr-1 pl-3 text-[12px] text-muted-foreground hover:bg-secondary">
                            <Link
                              to={`${item.path}?${view.query}`}
                              onClick={() => setOpenSavedViewFor(null)}
                              className="flex-1 truncate hover:text-accent-foreground"
                            >
                              {view.name}
                            </Link>
                            <button
                              type="button"
                              aria-label={intl.formatMessage({ id: "listRibbon.deleteView" }, { name: view.name })}
                              onClick={() => userViews.remove(item.gridId as string, view.id)}
                              className="invisible rounded p-0.5 text-muted-foreground group-hover:visible hover:text-foreground"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {!folded && hiddenItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedCategories((prev) => ({ ...prev, [category.id]: !expanded }))}
                    className="mx-2 flex h-6 w-[calc(100%-1rem)] items-center rounded-md pr-2 pl-[38px] text-left text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    {expanded
                      ? intl.formatMessage({ id: "sidebar.showLess" })
                      : intl.formatMessage({ id: "sidebar.showMore" }, { count: hiddenItems.length })}
                  </button>
                )}
              </div>
            );
          })}

        </>
      )}
      </div>

      {access?.partnerRestricted && (
        <p className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground" data-testid="sidebar-partner-scope">
          {intl.formatMessage({ id: "hr.sidebar.assignedPartners" }, { count: access.assignedPartnerCount })}
        </p>
      )}

      {/* User request 2026-11-24: search, settings and log out at the foot of the sidebar, in place
          of the top bar. */}
      <div className="flex shrink-0 items-center gap-1 border-t p-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_GLOBAL_SEARCH_EVENT))}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={intl.formatMessage({ id: "search.title" })}
          data-testid="header-search"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="truncate">{intl.formatMessage({ id: "search.title" })}</span>
          <kbd className="ml-auto rounded border bg-muted px-1 font-mono text-[10px]">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <SettingsMenu sections={settingsSections} activePath={location.pathname} />
        {onLogout && (
          <AccountMenu compact email={auth?.email} companyName={activeCompany?.name} onChangeCompany={onChangeCompany ?? (() => {})} onLogout={onLogout} />
        )}
      </div>
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
  const location = useLocation();
  return (
    <div
      className={cn(
        "mx-2 flex h-7 items-center rounded-md pr-2 pl-3 text-[13px]",
        active
          ? "bg-nav-active font-semibold text-nav-active-foreground shadow-[inset_2px_0_0_var(--brand)]"
          : "text-secondary-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Link
        to={item.path}
        // Skip the navigation if this destination is already where the router is — a click on
        // an already-open register shouldn't pile up a redundant back-button stop.
        onClick={(event) => {
          if (location.pathname === item.path) event.preventDefault();
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5"
      >
        <item.icon className={cn("size-4 shrink-0", active ? "text-nav-active-foreground" : "text-muted-foreground")} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </Link>
      {hasSavedViews && (
        <button
          type="button"
          onClick={onToggleSavedViews}
          aria-label={intl.formatMessage({ id: savedViewsOpen ? "sidebar.savedViews.collapse" : "sidebar.savedViews.expand" })}
          className={cn(
            "ml-1 shrink-0",
            active ? "text-nav-active-foreground/70 hover:text-nav-active-foreground" : "text-muted-foreground hover:text-foreground",
          )}
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
  isAllowed,
  onUnstar,
  onPin,
  userId,
}: {
  prefs: SidebarPrefs;
  intl: ReturnType<typeof useIntl>;
  isActive: (path: string) => boolean;
  isAllowed: (path: string) => boolean;
  onUnstar: (path: string) => void;
  onPin: (path: string) => void;
  userId: string | null;
}) {
  const starredItems = prefs.favourites
    .map((path) => allItemsByPath.get(path))
    .filter((i): i is NavItem => !!i && isAllowed(i.path));
  const location = useLocation();

  // Build the "Suggested" list: top-visited paths that are not already pinned and not
  // top/bottom nav items (those are always visible and don't benefit from suggestion).
  const pinnedSet = new Set(prefs.favourites);
  const excludedPaths = new Set([...topNavItems.map((i) => i.path), ...bottomNavItems.map((i) => i.path)]);
  const SUGGESTION_LIMIT = 3;
  // Over-fetch so we have enough candidates after filtering out pinned/excluded paths.
  const topPaths = userId ? getTopNavPaths(userId, SUGGESTION_LIMIT + pinnedSet.size + excludedPaths.size) : [];
  const suggestions = topPaths
    .filter((path) => !pinnedSet.has(path) && !excludedPaths.has(path) && allItemsByPath.has(path) && isAllowed(path))
    .slice(0, SUGGESTION_LIMIT)
    .map((path) => allItemsByPath.get(path)!)

  return (
    <div>
      <div className="mt-3 mb-0.5 flex h-6 items-center gap-1.5 px-4">
        <Star className="size-3 fill-warning-foreground text-warning-foreground" />
        <span className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {intl.formatMessage({ id: "sidebar.category.favourites" })}
        </span>
      </div>
      {favouriteActions.filter((action) => isAllowed(action.path)).map((action) => (
        <Link
          key={action.id}
          to={action.path}
          className="mx-2 flex h-7 items-center rounded-md pr-2 pl-3 text-[13px] font-medium text-primary hover:bg-accent"
        >
          <action.icon className="mr-2.5 size-4 shrink-0" aria-hidden="true" />
          {/* The icon carries the "+", so the label drops it (the original keys stay for other uses). */}
          {intl.formatMessage({ id: `${action.labelKey}.short` })}
        </Link>
      ))}
      {starredItems.map((item) => (
        <div
          key={item.path}
          className={cn(
            "group mx-2 flex h-7 items-center rounded-md pr-1 pl-3 text-[13px]",
            isActive(item.path)
              ? "bg-nav-active font-semibold text-nav-active-foreground shadow-[inset_2px_0_0_var(--brand)]"
              : "text-secondary-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <Link
            to={item.path}
            onClick={(event) => {
              if (location.pathname === item.path) event.preventDefault();
            }}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <item.icon className={cn("size-4 shrink-0", isActive(item.path) ? "text-nav-active-foreground" : "text-muted-foreground")} aria-hidden="true" />
            <span className="truncate">{intl.formatMessage({ id: item.titleKey })}</span>
          </Link>
          <button
            type="button"
            onClick={() => onUnstar(item.path)}
            aria-label={intl.formatMessage({ id: "sidebar.removeFavourite" })}
            className={cn(
              "shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100",
              isActive(item.path)
                ? "text-nav-active-foreground/70 hover:bg-brand/10 hover:text-nav-active-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}

      {suggestions.length > 0 && (
        <>
          <div className="mt-1.5 flex h-5 items-center px-4">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              {intl.formatMessage({ id: "sidebar.suggested" })}
            </span>
          </div>
          {suggestions.map((item) => (
            <div
              key={item.path}
              className={cn(
                "group mx-2 flex h-7 items-center rounded-md pr-1 pl-3 text-[13px]",
                isActive(item.path)
                  ? "bg-nav-active font-semibold text-nav-active-foreground shadow-[inset_2px_0_0_var(--brand)]"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Link
                to={item.path}
                onClick={(event) => {
                  if (location.pathname === item.path) event.preventDefault();
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5"
              >
                <item.icon className={cn("size-4 shrink-0", isActive(item.path) ? "text-nav-active-foreground" : "text-muted-foreground")} aria-hidden="true" />
                <span className="truncate">{intl.formatMessage({ id: item.titleKey })}</span>
              </Link>
              <button
                type="button"
                onClick={() => onPin(item.path)}
                aria-label={intl.formatMessage({ id: "sidebar.pinFavourite" })}
                className="shrink-0 rounded p-0.5 text-muted-foreground/40 opacity-0 hover:text-warning-foreground group-hover:opacity-100"
              >
                <Star className="size-3" />
              </button>
            </div>
          ))}
        </>
      )}
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
  const orderedItems = [
    ...catPrefs.order.map((id) => itemsById.get(id)).filter((i): i is NavItem => !!i),
    ...category.items.filter((i) => !catPrefs.order.includes(i.path)),
  ];

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    // The panel's position is captured once from the trigger's bounding rect at open time —
    // rather than tracking it live on every scroll/resize, close it. Simpler than repositioning
    // and avoids a stale, visually detached popover. `scroll` needs capture: true because it
    // doesn't bubble, and the sidebar itself is a scroll container.
    function handleReposition() {
      onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
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
      <div className="max-h-72 overflow-y-auto scrollbar-brand">
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
                <Checkbox
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
