import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from "@/components/ui/confirm-context";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface PendingConfirm {
  message: string;
  onConfirm: () => void;
  options?: ConfirmOptions;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const intl = useIntl();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((message, onConfirm, options) => {
    setPending({ message, onConfirm, options });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "confirm.title" })}</DialogTitle>
            <DialogDescription className="text-foreground">{pending?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" autoFocus onClick={() => setPending(null)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              variant={pending?.options?.destructive ? "destructive" : "default"}
              onClick={() => {
                const action = pending?.onConfirm;
                setPending(null);
                action?.();
              }}
            >
              {pending?.options?.confirmLabel ?? intl.formatMessage({ id: "confirm.confirm" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
