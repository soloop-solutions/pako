import { useCallback, useEffect, useRef, useState } from "react";
import type { FavoriteResponse } from "@pako/shared";

import { apiClient } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";

// ---------------------------------------------------------------------------
// Smart Favorites hook — loads, caches, and mutates user favorites for a given
// entity type (Account, Partner, Item, etc.) scoped to the current user + company.
//
// Returns:
//  - pinnedIds:      Set of manually pinned entity IDs
//  - autoIds:        Set of automatically suggested entity IDs (by frequency)
//  - suppressedIds:  Set of suppressed entity IDs
//  - allFavoriteIds: Set of all favorite IDs (pinned + auto, minus suppressed)
//  - pin/unpin:      Toggle manual pin
//  - suppress:       Dismiss an automatic suggestion
//  - recordSelection: Track a meaningful selection (call on confirmed save/commit)
//  - isFavorite:     Check if an entity is a favorite
//  - isPinned:       Check if an entity is manually pinned
//  - sortWithFavorites: Sort an array of options, favorites first
// ---------------------------------------------------------------------------

/** Minimum selections before an entity becomes an automatic favorite. */
const AUTO_FAVORITE_THRESHOLD = 3;
/** Maximum automatic favorites shown. */
const MAX_AUTO_FAVORITES = 10;

export interface EntityFavoritesResult {
  pinnedIds: Set<string>;
  autoIds: Set<string>;
  suppressedIds: Set<string>;
  allFavoriteIds: Set<string>;
  loading: boolean;
  pin: (entityId: string) => void;
  unpin: (entityId: string) => void;
  suppress: (entityId: string) => void;
  recordSelection: (entityId: string) => void;
  isFavorite: (entityId: string) => boolean;
  isPinned: (entityId: string) => boolean;
  sortWithFavorites: <T extends { id?: string; value?: string }>(items: T[]) => T[];
}

export function useEntityFavorites(entityType: string): EntityFavoritesResult {
  const { auth } = useAuth();
  const { activeCompanyId } = useCompany();
  const [favorites, setFavorites] = useState<FavoriteResponse[]>([]);
  const [loading, setLoading] = useState(false);

  // Buffer selections to batch them
  const pendingSelectionsRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load favorites
  useEffect(() => {
    if (!auth || !activeCompanyId) return;
    let cancelled = false;
    setLoading(true);

    apiClient.favorites(activeCompanyId, entityType)
      .then((res) => {
        if (!cancelled) setFavorites(res.items);
      })
      .catch(() => {
        // Silently fail — favorites are not critical
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [auth, activeCompanyId, entityType]);

  // Compute sets
  const pinnedIds = new Set(
    favorites.filter((f) => f.isPinned).map((f) => f.entityId),
  );

  const suppressedIds = new Set(
    favorites.filter((f) => f.isSuppressed).map((f) => f.entityId),
  );

  const autoIds = new Set(
    favorites
      .filter(
        (f) =>
          !f.isPinned &&
          !f.isSuppressed &&
          f.selectionCount >= AUTO_FAVORITE_THRESHOLD,
      )
      .sort((a, b) => b.selectionCount - a.selectionCount)
      .slice(0, MAX_AUTO_FAVORITES)
      .map((f) => f.entityId),
  );

  const allFavoriteIds = new Set([...pinnedIds, ...autoIds]);

  const pin = useCallback(
    (entityId: string) => {
      if (!activeCompanyId) return;
      // Optimistic update
      setFavorites((prev) => {
        const existing = prev.find((f) => f.entityId === entityId);
        if (existing) {
          return prev.map((f) =>
            f.entityId === entityId ? { ...f, isPinned: true, isSuppressed: false } : f,
          );
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            entityId,
            entityType,
            isPinned: true,
            isSuppressed: false,
            selectionCount: 0,
            lastSelectedAtUtc: undefined,
          } as FavoriteResponse,
        ];
      });
      apiClient.pin(activeCompanyId, entityType, entityId, { isPinned: true }).catch(() => {
        // Revert on failure — reload
        apiClient.favorites(activeCompanyId, entityType).then((res) => setFavorites(res.items)).catch(() => {});
      });
    },
    [activeCompanyId, entityType],
  );

  const unpin = useCallback(
    (entityId: string) => {
      if (!activeCompanyId) return;
      setFavorites((prev) =>
        prev.map((f) => (f.entityId === entityId ? { ...f, isPinned: false } : f)),
      );
      apiClient.pin(activeCompanyId, entityType, entityId, { isPinned: false }).catch(() => {
        apiClient.favorites(activeCompanyId, entityType).then((res) => setFavorites(res.items)).catch(() => {});
      });
    },
    [activeCompanyId, entityType],
  );

  const suppress = useCallback(
    (entityId: string) => {
      if (!activeCompanyId) return;
      setFavorites((prev) =>
        prev.map((f) => (f.entityId === entityId ? { ...f, isSuppressed: true } : f)),
      );
      apiClient.suppress(activeCompanyId, entityType, entityId, { isSuppressed: true }).catch(() => {
        apiClient.favorites(activeCompanyId, entityType).then((res) => setFavorites(res.items)).catch(() => {});
      });
    },
    [activeCompanyId, entityType],
  );

  // Flush batched selections to the API
  const flush = useCallback(() => {
    if (!activeCompanyId || pendingSelectionsRef.current.length === 0) return;
    const batch = pendingSelectionsRef.current;
    pendingSelectionsRef.current = [];
    apiClient
      .selections(activeCompanyId, {
        selections: batch.map((id) => ({ entityId: id, entityType })),
      })
      .catch(() => {});

    // Optimistic local update
    setFavorites((prev) => {
      const map = new Map(prev.map((f) => [f.entityId, f]));
      const now = new Date().toISOString();
      for (const id of batch) {
        const existing = map.get(id);
        if (existing) {
          map.set(id, {
            ...existing,
            selectionCount: existing.selectionCount + 1,
            lastSelectedAtUtc: now,
          });
        } else {
          map.set(id, {
            id: crypto.randomUUID(),
            entityId: id,
            entityType,
            isPinned: false,
            isSuppressed: false,
            selectionCount: 1,
            lastSelectedAtUtc: now,
          } as FavoriteResponse);
        }
      }
      return Array.from(map.values());
    });
  }, [activeCompanyId, entityType]);

  const recordSelection = useCallback(
    (entityId: string) => {
      pendingSelectionsRef.current.push(entityId);
      // Debounce: flush after 2 seconds of inactivity
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flush, 2000);
    },
    [flush],
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flush();
    };
  }, [flush]);

  const isFavorite = useCallback(
    (entityId: string) => allFavoriteIds.has(entityId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites],
  );

  const isPinned = useCallback(
    (entityId: string) => pinnedIds.has(entityId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites],
  );

  const sortWithFavorites = useCallback(
    <T extends { id?: string; value?: string }>(items: T[]): T[] => {
      const getId = (item: T) => item.id ?? item.value ?? "";
      return [...items].sort((a, b) => {
        const aId = getId(a);
        const bId = getId(b);
        const aPinned = pinnedIds.has(aId);
        const bPinned = pinnedIds.has(bId);
        const aAuto = autoIds.has(aId);
        const bAuto = autoIds.has(bId);

        // Pinned first
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        // Then auto favorites
        if (aAuto && !bAuto) return -1;
        if (!aAuto && bAuto) return 1;
        // Within same tier, preserve original order
        return 0;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites],
  );

  return {
    pinnedIds,
    autoIds,
    suppressedIds,
    allFavoriteIds,
    loading,
    pin,
    unpin,
    suppress,
    recordSelection,
    isFavorite,
    isPinned,
    sortWithFavorites,
  };
}
