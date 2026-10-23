import { DEFAULT_VISIBLE_COUNT, navCategories, type NavCategory } from "@/config/nav";

export interface CategoryPrefs {
  /** Every item id (path) in this category, in display order. */
  order: string[];
  /** Subset of `order` hidden behind "Shfaq më shumë". */
  hidden: string[];
}

export interface SidebarPrefs {
  /** Item ids (paths) starred into Favourites, in display order. Excludes the fixed create actions. */
  favourites: string[];
  categories: Record<string, CategoryPrefs>;
}

function storageKey(userId: string): string {
  return `pako.sidebarPrefs.${userId}`;
}

function defaultCategoryPrefs(category: NavCategory): CategoryPrefs {
  const order = category.items.map((item) => item.path);
  return { order, hidden: order.slice(DEFAULT_VISIBLE_COUNT) };
}

export function emptyPrefs(): SidebarPrefs {
  const categories: Record<string, CategoryPrefs> = {};
  for (const category of navCategories) {
    categories[category.id] = defaultCategoryPrefs(category);
  }
  return { favourites: [], categories };
}

/** Reconciles stored prefs against the current nav.ts — new items appear (visible) at the end,
 * removed items disappear, without discarding the rest of the user's customisation. */
function reconcileCategory(category: NavCategory, stored: CategoryPrefs | undefined): CategoryPrefs {
  const currentIds = category.items.map((item) => item.path);
  const currentSet = new Set(currentIds);
  const storedOrder = (stored?.order ?? []).filter((id) => currentSet.has(id));
  const missing = currentIds.filter((id) => !storedOrder.includes(id));
  const order = [...storedOrder, ...missing];
  const hidden = (stored?.hidden ?? []).filter((id) => currentSet.has(id));
  return { order, hidden };
}

function reconcile(prefs: SidebarPrefs): SidebarPrefs {
  const allIds = new Set(navCategories.flatMap((c) => c.items.map((i) => i.path)));
  const categories: Record<string, CategoryPrefs> = {};
  for (const category of navCategories) {
    categories[category.id] = reconcileCategory(category, prefs.categories[category.id]);
  }
  return { favourites: prefs.favourites.filter((id) => allIds.has(id)), categories };
}

export function loadSidebarPrefs(userId: string): SidebarPrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return emptyPrefs();
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>;
    const base = emptyPrefs();
    return reconcile({
      favourites: Array.isArray(parsed.favourites) ? parsed.favourites : base.favourites,
      categories: parsed.categories && typeof parsed.categories === "object" ? { ...base.categories, ...parsed.categories } : base.categories,
    });
  } catch {
    return emptyPrefs();
  }
}

export function saveSidebarPrefs(userId: string, prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    // Storage unavailable — customisation just won't persist across reloads.
  }
}

// ---------------------------------------------------------------------------
// Navigation frequency tracking — powers the "Suggested" sub-section inside
// Favourites by surfacing the pages the user visits most often.
// ---------------------------------------------------------------------------

function navFreqKey(userId: string): string {
  return `pako.navFreq.${userId}`;
}

/** Increments the visit counter for `path`. Call on every sidebar nav click. */
export function recordNavigation(userId: string, path: string): void {
  try {
    const raw = localStorage.getItem(navFreqKey(userId));
    const freq: Record<string, number> = raw ? JSON.parse(raw) : {};
    freq[path] = (freq[path] ?? 0) + 1;
    localStorage.setItem(navFreqKey(userId), JSON.stringify(freq));
  } catch {
    // Storage unavailable — suggestions just won't appear.
  }
}

/** Returns the `limit` most-visited paths, most frequent first. */
export function getTopNavPaths(userId: string, limit: number): string[] {
  try {
    const raw = localStorage.getItem(navFreqKey(userId));
    if (!raw) return [];
    const freq: Record<string, number> = JSON.parse(raw);
    return Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([path]) => path);
  } catch {
    return [];
  }
}
