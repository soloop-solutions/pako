import { useSearchParams } from "react-router-dom";

// A filter kept in the URL (frontend rule: filters are linkable and survive a reload). Writing it
// keeps every other parameter, such as the panel's ?tab=.
export function useUrlParam(name: string, fallback = ""): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? fallback;
  const set = (next: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next && next !== fallback) p.set(name, next);
        else p.delete(name);
        return p;
      },
      { replace: true },
    );
  return [value, set];
}
