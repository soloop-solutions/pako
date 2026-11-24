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
  getBackupSettings(): Promise<{
    dir: string
    retentionDays: number
    lastBackupAt: string | null
    lastAutoBackupFailure?: { at: string; error: string } | null
  }>
  openLogFolder(): Promise<void>
}

// "Allow tills on this network" (desktop): this PC serves the till and the KDS to tablets on the
// shop network, all on this PC's one database. Off by default.
export interface TillNetworkStatus {
  enabled: boolean
  port: number
  // Listening on the network now (false when on but the port was taken, see error).
  running: boolean
  // http://<address>:<port> for each network this PC is on; the first is the one links use.
  urls: string[]
  error: string | null
}

export type TillNetworkResult = { ok: true; status: TillNetworkStatus } | { ok: false; error: string }

// Optional on the bridge: older desktop builds don't have them.
export interface DesktopTillNetworkBridge {
  getTillNetwork(): Promise<TillNetworkStatus>
  setTillNetwork(settings: { enabled: boolean; port: number }): Promise<TillNetworkResult>
}
