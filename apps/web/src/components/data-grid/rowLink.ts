import type { KeyboardEvent, MouseEvent } from "react";

const INTERACTIVE = "button, a, input, select, label, textarea";

export interface RowLinkProps {
  tabIndex: number;
  "data-row-link": string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onAuxClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

function openInNewTab(path: string) {
  window.open(path, "_blank", "noopener");
}

export function rowLinkProps(path: string, navigate: (path: string) => void): RowLinkProps {
  return {
    tabIndex: 0,
    "data-row-link": path,
    onClick: (event) => {
      if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
      if (window.getSelection()?.toString()) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        openInNewTab(path);
        return;
      }
      navigate(path);
    },
    onAuxClick: (event) => {
      if (event.button !== 1) return;
      if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
      event.preventDefault();
      openInNewTab(path);
    },
    onKeyDown: (event) => {
      if (event.key !== "Enter" || event.target !== event.currentTarget) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        openInNewTab(path);
        return;
      }
      navigate(path);
    },
  };
}

export const ROW_LINK_CLASS = "cursor-pointer hover:bg-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
