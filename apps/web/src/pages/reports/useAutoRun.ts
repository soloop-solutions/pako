import { useEffect, useRef } from "react";

export function useAutoRun(ready: boolean, key: string | null, run: () => void) {
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || key === null || loadedKey.current === key) return;
    loadedKey.current = key;
    run();
  }, [ready, key, run]);
  return loadedKey;
}
