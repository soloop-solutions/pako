import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { DesktopSettingsPanel } from "@/pages/settings/DesktopSettingsPanel";

const info = { file: "pako-2026-11-10.bak", createdAt: "2026-11-10T08:00:00Z", appVersion: "1.0.0", schemaVersion: "20261031", sizeBytes: 2048 };

const bridge = {
  isDesktop: true as const,
  version: "1.0.0",
  backupNow: vi.fn(),
  listBackups: vi.fn(),
  restoreFromFile: vi.fn(),
  chooseBackupDir: vi.fn(),
  getBackupSettings: vi.fn(),
  openLogFolder: vi.fn(),
};

function setBridge() {
  (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = bridge;
}

function renderPanel() {
  return render(
    <IntlProviderWrapper>
      <ConfirmProvider>
        <DesktopSettingsPanel />
      </ConfirmProvider>
    </IntlProviderWrapper>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
  Object.values(bridge).forEach((m) => typeof m === "function" && "mockReset" in m && (m as ReturnType<typeof vi.fn>).mockReset());
  bridge.listBackups.mockResolvedValue([info]);
  bridge.getBackupSettings.mockResolvedValue({ dir: "/Users/a/PAKO Backups", retentionDays: 30, lastBackupAt: "2026-11-10T08:00:00Z" });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
});

describe("DesktopSettingsPanel", () => {
  it("DesktopSettings_HiddenInBrowser", () => {
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it("DesktopSettings_WarnsWhenBackupStale", async () => {
    setBridge();
    renderPanel();
    expect(await screen.findByText(/older than 3 days/i)).toBeInTheDocument();
    expect(screen.getByText("/Users/a/PAKO Backups")).toBeInTheDocument();
    expect(screen.getByText("pako-2026-11-10.bak")).toBeInTheDocument();
  });

  it("DesktopSettings_NoWarningWhenRecent", async () => {
    setBridge();
    bridge.getBackupSettings.mockResolvedValue({ dir: "/b", retentionDays: 30, lastBackupAt: "2026-11-17T08:00:00Z" });
    renderPanel();
    await screen.findByText("/b");
    expect(screen.queryByText(/older than 3 days/i)).not.toBeInTheDocument();
  });

  it("DesktopSettings_WarnsWhenNoBackup", async () => {
    setBridge();
    bridge.getBackupSettings.mockResolvedValue({ dir: "/b", retentionDays: 30, lastBackupAt: null });
    bridge.listBackups.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText(/No backup has been made yet/i)).toBeInTheDocument();
  });

  it("DesktopSettings_RestoreAsksFirstThenCallsBridge", async () => {
    setBridge();
    bridge.restoreFromFile.mockResolvedValue({ ok: true, verify: { ok: true, failures: [] } });
    renderPanel();
    await screen.findByText("/Users/a/PAKO Backups");
    fireEvent.click(screen.getByRole("button", { name: "Restore from file" }));
    expect(bridge.restoreFromFile).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Choose file" }));
    });
    await waitFor(() => expect(bridge.restoreFromFile).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/was restored/i)).toBeInTheDocument();
  });

  it("DesktopSettings_BackupNowShowsOutcome", async () => {
    setBridge();
    bridge.backupNow.mockResolvedValue({ ok: true, info });
    renderPanel();
    await screen.findByText("/Users/a/PAKO Backups");
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(await screen.findByText(/Backup saved/)).toBeInTheDocument();
    expect(bridge.backupNow).toHaveBeenCalled();
  });
});
