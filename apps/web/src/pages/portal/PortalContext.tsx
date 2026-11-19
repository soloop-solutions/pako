import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { apiClient } from "@/api/client";
import { PortalStateContext, type PortalCartLine, type PortalContextValue } from "@/pages/portal/portal-context";

// Client feedback phase 5 — the customer portal's state: which company the customer is buying
// from (one login can be a customer of several) and the cart. The cart only holds what was picked
// (item, unit, quantity): every price and total comes from the API (pricePortalCart).

const ACTIVE_KEY = "pako.portalCompanyId";
const cartKey = (companyId: string) => `pako.portalCart.${companyId}`;


const sameLine = (a: { itemId: string; unitName?: string }, itemId: string, unitName: string | undefined) =>
  a.itemId === itemId && (a.unitName ?? "") === (unitName ?? "");

function readCart(companyId: string | null): PortalCartLine[] {
  if (!companyId) return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(cartKey(companyId)) ?? "[]") as PortalCartLine[];
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.itemId === "string" && l.quantity > 0) : [];
  } catch {
    return [];
  }
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: ["portal", "companies"], queryFn: () => apiClient.listPortalCompanies() });
  const companies = useMemo(() => query.data ?? [], [query.data]);
  const [chosen, setChosen] = useState<string | null>(() => sessionStorage.getItem(ACTIVE_KEY));
  const company = companies.find((c) => c.companyId === chosen) ?? companies[0] ?? null;
  const companyId = company?.companyId ?? null;
  const [cart, setCart] = useState<PortalCartLine[]>(() => readCart(companyId));

  // The cart belongs to one company: switching companies switches carts.
  useEffect(() => setCart(readCart(companyId)), [companyId]);

  const save = useCallback((next: PortalCartLine[]) => {
    setCart(next);
    if (companyId) sessionStorage.setItem(cartKey(companyId), JSON.stringify(next));
  }, [companyId]);

  const value = useMemo<PortalContextValue>(() => ({
    companies,
    loaded: query.isFetched,
    company,
    companyId,
    setCompanyId: (id: string) => {
      sessionStorage.setItem(ACTIVE_KEY, id);
      setChosen(id);
    },
    cart,
    addToCart: (line) => {
      const existing = cart.find((l) => sameLine(l, line.itemId, line.unitName));
      save(existing
        ? cart.map((l) => (l === existing ? { ...l, quantity: l.quantity + line.quantity } : l))
        : [...cart, line]);
    },
    setQuantity: (itemId, unitName, quantity) =>
      save(quantity > 0 ? cart.map((l) => (sameLine(l, itemId, unitName) ? { ...l, quantity } : l)) : cart.filter((l) => !sameLine(l, itemId, unitName))),
    removeFromCart: (itemId, unitName) => save(cart.filter((l) => !sameLine(l, itemId, unitName))),
    clearCart: () => save([]),
  }), [companies, query.isFetched, company, companyId, cart, save]);

  return <PortalStateContext.Provider value={value}>{children}</PortalStateContext.Provider>;
}
