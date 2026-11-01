import { useCallback, useRef, useState } from "react";
import { useIntl } from "react-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type FormDialogSize = "sm" | "md" | "lg" | "xl" | "full";

const sizeClasses: Record<FormDialogSize, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-2xl",
  lg: "sm:max-w-4xl",
  xl: "sm:max-w-6xl",
  full: "sm:max-w-7xl",
};

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: FormDialogSize;
  /** Whether the form has unsaved changes. When true, closing shows a confirmation. */
  dirty?: boolean;
  children: React.ReactNode;
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  dirty = false,
  children,
}: FormDialogProps) {
  const intl = useIntl();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingClose = useRef(false);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && dirty) {
        pendingClose.current = true;
        setConfirmOpen(true);
        return;
      }
      onOpenChange(next);
    },
    [dirty, onOpenChange],
  );

  const handleDiscard = useCallback(() => {
    setConfirmOpen(false);
    pendingClose.current = false;
    onOpenChange(false);
  }, [onOpenChange]);

  const handleContinue = useCallback(() => {
    setConfirmOpen(false);
    pendingClose.current = false;
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={`overflow-y-auto ${size === "full" ? "max-h-[calc(100vh-2rem)]" : "max-h-[90vh]"} ${sizeClasses[size]}`}
          onPointerDownOutside={(e) => {
            // Prevent closing when clicking inside portalled popovers (SearchableSelect,
            // date pickers) or portalled overlays (InvoicePreviewDialog).
            const target = e.target as HTMLElement | null;
            if (target?.closest("[data-radix-popper-content-wrapper]") || target?.closest("[data-pako-overlay]")) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>

      {/* Unsaved changes confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "formDialog.unsavedTitle" })}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: "formDialog.unsavedDescription" })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleContinue}>
              {intl.formatMessage({ id: "formDialog.continueEditing" })}
            </Button>
            <Button variant="destructive" onClick={handleDiscard}>
              {intl.formatMessage({ id: "formDialog.discard" })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
