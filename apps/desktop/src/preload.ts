import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopTillNetworkBridge } from '@pako/shared'
import { IPC } from './ipcChannels'

const bridge: DesktopBridge & DesktopTillNetworkBridge = {
  isDesktop: true,
  version: ipcRenderer.sendSync(IPC.version) as string,
  backupNow: () => ipcRenderer.invoke(IPC.backupNow),
  listBackups: () => ipcRenderer.invoke(IPC.listBackups),
  restoreFromFile: () => ipcRenderer.invoke(IPC.restoreFromFile),
  chooseBackupDir: () => ipcRenderer.invoke(IPC.chooseBackupDir),
  getBackupSettings: () => ipcRenderer.invoke(IPC.getBackupSettings),
  openLogFolder: () => ipcRenderer.invoke(IPC.openLogFolder),
  getTillNetwork: () => ipcRenderer.invoke(IPC.getTillNetwork),
  setTillNetwork: (settings) => ipcRenderer.invoke(IPC.setTillNetwork, settings),
}

contextBridge.exposeInMainWorld('pakoDesktop', bridge)
