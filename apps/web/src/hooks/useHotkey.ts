import { useEffect, useRef } from "react";

// Client request 2026-11-24: keyboard shortcuts. One listener per registered key; the router mounts
// only the current page, so a page's shortcut never fires from another tab.
//  - "n"     new document on a list page
//  - "/"     focus the list's search box
//  - "mod+s" save in an editor (Ctrl+S, ⌘S on a Mac); the browser's "save page" is suppressed
//  - "?"     the shortcut help (mounted once in the layout)
// Plain keys are ignored while the user types in a field or a dialog is open; mod+s always works.
export type Hotkey = "n" | "/" | "mod+s" | "?";

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function matches(event: KeyboardEvent, hotkey: Hotkey): boolean {
  if (hotkey === "mod+s") return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s";
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (hotkey === "?") return event.key === "?";
  return event.key.toLowerCase() === hotkey;
}

export function useHotkey(hotkey: Hotkey, handler: () => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matches(event, hotkey)) return;
      if (hotkey !== "mod+s") {
        if (isTypingTarget(event.target)) return;
        if (document.querySelector("[role='dialog']")) return;
      }
      event.preventDefault();
      handlerRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hotkey, enabled]);
}
