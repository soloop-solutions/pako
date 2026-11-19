export const IPC = {
  version: 'pako:version',
  backupNow: 'pako:backup-now',
  listBackups: 'pako:list-backups',
  restoreFromFile: 'pako:restore-from-file',
  chooseBackupDir: 'pako:choose-backup-dir',
  getBackupSettings: 'pako:get-backup-settings',
  openLogFolder: 'pako:open-log-folder',
} as const
