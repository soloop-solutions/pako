import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import type { BackupInfo, DesktopBridge } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-context";
import { getDesktopBridge } from "@/lib/desktopBridge";

const STALE_MS = 3 * 24 * 60 * 60 * 1000;

interface BackupSettings {
  dir: string;
  retentionDays: number;
  lastBackupAt: string | null;
  lastAutoBackupFailure?: { at: string; error: string } | null;
}

type Notice = { tone: "ok" | "error"; text: string };

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Panel({ bridge }: { bridge: DesktopBridge }) {
  const intl = useIntl();
  const confirm = useConfirm();
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextSettings, nextBackups] = await Promise.all([bridge.getBackupSettings(), bridge.listBackups()]);
      setSettings(nextSettings);
      setBackups(nextBackups);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fmt = (iso: string) => intl.formatDate(iso, { dateStyle: "medium", timeStyle: "short" });

  async function backupNow() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await bridge.backupNow();
      setNotice(
        result.ok
          ? { tone: "ok", text: intl.formatMessage({ id: "desktop.settings.backupSaved" }, { file: result.info.file }) }
          : { tone: "error", text: intl.formatMessage({ id: "desktop.settings.backupFailed" }, { error: result.error }) },
      );
    } catch (err) {
      setNotice({ tone: "error", text: intl.formatMessage({ id: "desktop.settings.backupFailed" }, { error: String(err) }) });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function restore() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await bridge.restoreFromFile();
      if (!result.ok) {
        setNotice({ tone: "error", text: intl.formatMessage({ id: "desktop.settings.restoreFailed" }, { error: result.error }) });
      } else if (!result.verify.ok) {
        setNotice({
          tone: "error",
          text: intl.formatMessage({ id: "desktop.settings.restoreVerifyFailed" }, { count: result.verify.failures.length }),
        });
      } else {
        setNotice({ tone: "ok", text: intl.formatMessage({ id: "desktop.settings.restoreDone" }) });
      }
    } catch (err) {
      setNotice({ tone: "error", text: intl.formatMessage({ id: "desktop.settings.restoreFailed" }, { error: String(err) }) });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function changeDir() {
    const dir = await bridge.chooseBackupDir();
    if (dir) await refresh();
  }

  const last = settings?.lastBackupAt ?? null;
  const warning = settings
    ? last === null
      ? "desktop.settings.noBackupWarning"
      : Date.now() - new Date(last).getTime() > STALE_MS
        ? "desktop.settings.staleWarning"
        : null
    : null;

  const failure = settings?.lastAutoBackupFailure ?? null;
  const showFailure =
    failure !== null && (last === null || new Date(failure.at).getTime() > new Date(last).getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "desktop.settings.title" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "desktop.settings.description" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loadFailed && (
          <Alert variant="destructive">
            <AlertDescription>{intl.formatMessage({ id: "desktop.settings.loadError" })}</AlertDescription>
          </Alert>
        )}
        {warning && (
          <p role="alert" className="rounded-md border border-warning-border bg-warning px-3 py-2 text-sm font-medium text-warning-foreground">
            {intl.formatMessage({ id: warning })}
          </p>
        )}
        {showFailure && failure && (
          <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
            {intl.formatMessage({ id: "desktop.settings.autoBackupFailed" }, { date: fmt(failure.at), error: failure.error })}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className={
              notice.tone === "ok"
                ? "rounded-md border border-border bg-muted px-3 py-2 text-sm"
                : "rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
            }
          >
            {notice.text}
          </p>
        )}
        {settings && (
          <dl className="grid max-w-xl grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{intl.formatMessage({ id: "desktop.settings.folder" })}</dt>
            <dd className="truncate font-mono text-xs">{settings.dir}</dd>
            <dd>
              <Button type="button" variant="outline" size="sm" onClick={() => void changeDir()}>
                {intl.formatMessage({ id: "desktop.settings.change" })}
              </Button>
            </dd>
            <dt className="text-muted-foreground">{intl.formatMessage({ id: "desktop.settings.retention" })}</dt>
            <dd className="col-span-2">{intl.formatMessage({ id: "desktop.settings.retentionDays" }, { days: settings.retentionDays })}</dd>
            <dt className="text-muted-foreground">{intl.formatMessage({ id: "desktop.settings.lastBackup" })}</dt>
            <dd className="col-span-2">{last ? fmt(last) : intl.formatMessage({ id: "desktop.settings.never" })}</dd>
          </dl>
        )}
        <div className="flex gap-2">
          <Button type="button" disabled={busy} onClick={() => void backupNow()}>
            {busy ? intl.formatMessage({ id: "desktop.settings.backingUp" }) : intl.formatMessage({ id: "desktop.settings.backupNow" })}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              confirm(intl.formatMessage({ id: "desktop.settings.restoreConfirm" }), () => void restore(), {
                confirmLabel: intl.formatMessage({ id: "desktop.settings.restoreChoose" }),
                destructive: true,
              })
            }
          >
            {intl.formatMessage({ id: "desktop.settings.restore" })}
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">{intl.formatMessage({ id: "desktop.settings.list" })}</h4>
          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "desktop.settings.listEmpty" })}</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {backups.map((b) => (
                <li key={b.file} className="flex items-center justify-between gap-4 px-3 py-1.5">
                  <span className="truncate font-mono text-xs">{b.file}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {fmt(b.createdAt)} · {formatSize(b.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function DesktopSettingsPanel() {
  const bridge = getDesktopBridge();
  if (!bridge) return null;
  return <Panel bridge={bridge} />;
}
