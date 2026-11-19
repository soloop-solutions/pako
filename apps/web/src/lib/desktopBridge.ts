import type { DesktopBridge } from "@pako/shared";

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
