// docs/POS_PLAN.md P6: the device's position for a visit check-in, or null when it has none or the
// user said no — a visit can always be checked in without one.
export function currentPosition(): Promise<GeolocationCoordinates | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
