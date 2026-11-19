import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '@pako/shared'
import { IPC } from './ipcChannels'

const bridge: DesktopBridge = {
  isDesktop: true,
  version: ipcRenderer.sendSync(IPC.version) as string,
  backupNow: () => ipcRenderer.invoke(IPC.backupNow),
  listBackups: () => ipcRenderer.invoke(IPC.listBackups),
  restoreFromFile: () => ipcRenderer.invoke(IPC.restoreFromFile),
  chooseBackupDir: () => ipcRenderer.invoke(IPC.chooseBackupDir),
  getBackupSettings: () => ipcRenderer.invoke(IPC.getBackupSettings),
  openLogFolder: () => ipcRenderer.invoke(IPC.openLogFolder),
}

contextBridge.exposeInMainWorld('pakoDesktop', bridge)
