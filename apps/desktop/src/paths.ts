import nodePath from 'node:path'
import type { PathModule } from './types'

export interface DesktopPaths {
  dataDir: string
  pgData: string
  backupsDefault: string
  logDir: string
  configFile: string
}

export function resolvePaths(appData: string, pathModule: PathModule = nodePath): DesktopPaths {
  return {
    dataDir: appData,
    pgData: pathModule.join(appData, 'pgdata'),
    backupsDefault: pathModule.join(appData, 'backups'),
    logDir: pathModule.join(appData, 'logs'),
    configFile: pathModule.join(appData, 'config.json'),
  }
}
