import type { DesktopBridge, DesktopTillNetworkBridge } from "@pako/shared";

const METHODS = ["backupNow", "listBackups", "restoreFromFile", "chooseBackupDir", "getBackupSettings", "openLogFolder"] as const;

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
  if (!candidate || typeof candidate !== "object") return null;
  const bridge = candidate as Record<string, unknown>;
  if (bridge.isDesktop !== true) return null;
  if (!METHODS.every((m) => typeof bridge[m] === "function")) return null;
  return candidate as DesktopBridge;
}

// "Allow tills on this network" (desktop only, and only in builds that have it).
export function getTillNetworkBridge(): DesktopTillNetworkBridge | null {
  const bridge = getDesktopBridge() as (DesktopBridge & Partial<DesktopTillNetworkBridge>) | null;
  if (!bridge || typeof bridge.getTillNetwork !== "function" || typeof bridge.setTillNetwork !== "function") return null;
  return bridge as DesktopTillNetworkBridge;
}
