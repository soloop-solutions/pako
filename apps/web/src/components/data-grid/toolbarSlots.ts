import { useSyncExternalStore } from "react";

// User request 2026-11-24: a list's filter ribbon sits in its grid's toolbar row (filters, then the
// grid's search, columns and export), with the active-filter chips on a line below. The grid
// publishes two slot elements under its gridId; ListRibbon portals into them when they exist.
export interface GridToolbarSlots {
  controls: HTMLElement;
  chips: HTMLElement;
}

const slots = new Map<string, GridToolbarSlots>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function registerGridToolbarSlots(gridId: string, value: GridToolbarSlots): () => void {
  slots.set(gridId, value);
  notify();
  return () => {
    if (slots.get(gridId) === value) {
      slots.delete(gridId);
      notify();
    }
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGridToolbarSlots(gridId: string | undefined): GridToolbarSlots | undefined {
  return useSyncExternalStore(subscribe, () => (gridId ? slots.get(gridId) : undefined));
}
