import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";

// Client request 2026-11-24: row and bulk actions on the document lists.

/** A small icon button at the end of a grid row; the label is its tooltip and accessible name. */
export function RowActionButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-6"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon className="size-3.5" />
    </Button>
  );
}
