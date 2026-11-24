// Pretends the screen is a phone for useIsPhone (jsdom has no matchMedia). Returns the undo.
export function asPhone(): () => void {
  const previous = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = previous;
  };
}
