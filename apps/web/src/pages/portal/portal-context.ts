import type { PortalCompanyResponse } from "@pako/shared";
import { createContext, useContext } from "react";

export type PortalCartLine = { itemId: string; name: string; unitName?: string; quantity: number };

export type PortalContextValue = {
  companies: PortalCompanyResponse[];
  loaded: boolean;
  company: PortalCompanyResponse | null;
  companyId: string | null;
  setCompanyId: (id: string) => void;
  cart: PortalCartLine[];
  addToCart: (line: PortalCartLine) => void;
  setQuantity: (itemId: string, unitName: string | undefined, quantity: number) => void;
  removeFromCart: (itemId: string, unitName: string | undefined) => void;
  clearCart: () => void;
};

export const PortalStateContext = createContext<PortalContextValue | null>(null);

export function usePortal(): PortalContextValue {
  const value = useContext(PortalStateContext);
  if (!value) throw new Error("usePortal must be used inside PortalProvider");
  return value;
}

export function useRequiredPortalCompanyId(): string {
  const { companyId } = usePortal();
  if (!companyId) throw new Error("No portal company");
  return companyId;
}
