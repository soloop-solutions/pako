import { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";

export function useOpenParam(name = "open"): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const latest = useRef({ params, setParams });
  latest.current = { params, setParams };
  const set = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(latest.current.params);
      if (id) next.set(name, id);
      else next.delete(name);
      latest.current.setParams(next, { replace: true });
    },
    [name],
  );
  return [params.get(name) || null, set];
}
