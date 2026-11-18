export interface BackupInfo {
  file: string
  createdAt: string
  appVersion: string
  schemaVersion: string
  sizeBytes: number
}

export type BackupResult = { ok: true; info: BackupInfo } | { ok: false; error: string }

export type RestoreResult =
  | { ok: true; verify: { ok: boolean; failures: { companyId: string; reason: string }[] } }
  | { ok: false; error: string }

export interface DesktopBridge {
  isDesktop: true
  version: string
  backupNow(): Promise<BackupResult>
  listBackups(): Promise<BackupInfo[]>
  restoreFromFile(): Promise<RestoreResult>
  chooseBackupDir(): Promise<string | null>
  getBackupSettings(): Promise<{ dir: string; retentionDays: number; lastBackupAt: string | null }>
  openLogFolder(): Promise<void>
}
