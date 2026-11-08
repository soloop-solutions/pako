import { createContext, useContext } from "react";

export interface ConfirmOptions {
  confirmLabel?: string;
  destructive?: boolean;
}

export type ConfirmFn = (message: string, onConfirm: () => void, options?: ConfirmOptions) => void;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  return context ?? ((message, onConfirm) => {
    if (window.confirm(message)) onConfirm();
  });
}
