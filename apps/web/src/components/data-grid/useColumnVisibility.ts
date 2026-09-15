import { useCallback, useEffect, useState } from "react";
import type { Updater, VisibilityState } from "@tanstack/react-table";

function storageKey(gridId: string): string {
  return `pako.dataGrid.${gridId}.columnVisibility`;
}

function readStored(gridId: string): VisibilityState {
  try {
    const raw = localStorage.getItem(storageKey(gridId));
    return raw ? (JSON.parse(raw) as VisibilityState) : {};
  } catch {
    return {};
  }
}

export function useColumnVisibility(gridId: string): [VisibilityState, (updater: Updater<VisibilityState>) => void] {
  const [visibility, setVisibilityState] = useState<VisibilityState>(() => readStored(gridId));

  useEffect(() => {
    setVisibilityState(readStored(gridId));
  }, [gridId]);

  const setVisibility = useCallback(
    (updater: Updater<VisibilityState>) => {
      setVisibilityState((old) => {
        const next = typeof updater === "function" ? updater(old) : updater;
        try {
          localStorage.setItem(storageKey(gridId), JSON.stringify(next));
        } catch {
          return next;
        }
        return next;
      });
    },
    [gridId],
  );

  return [visibility, setVisibility];
}
