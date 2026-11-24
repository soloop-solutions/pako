import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipcChannels'

// Only for the app's own setup page (setup.html): the main process refuses these from any other
// page (tillMode.isSetupSender), so the main PC's pages loaded in a till window can't use them.
// A till window also shows the main PC's pages: they don't get the bridge at all.
if (window.location.protocol === 'file:')
  contextBridge.exposeInMainWorld('pakoSetup', {
    chooseMain: () => ipcRenderer.invoke(IPC.setupChooseMain),
    discover: () => ipcRenderer.invoke(IPC.setupDiscover),
    chooseTill: (address: string) => ipcRenderer.invoke(IPC.setupChooseTill, address),
    changeServer: () => ipcRenderer.invoke(IPC.setupChangeServer),
    retryNow: () => ipcRenderer.invoke(IPC.setupRetry),
  })
