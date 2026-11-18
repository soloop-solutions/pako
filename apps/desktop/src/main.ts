import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiProcess, buildApiEnv } from './api'
import { loadOrCreateConfig } from './config'
import { IPC } from './ipcChannels'
import { buildLaunchCookie, isAllowedNavigation, isExternalHttps } from './navPolicy'
import { resolvePaths } from './paths'
import { getFreePort } from './ports'
import { PostgresProcess } from './postgres'
import { setupSingleInstance } from './singleInstance'
import { createLoggedSpawn } from './spawn'
import { Supervisor } from './supervisor'

const here = nodePath.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | undefined
let splashWindow: BrowserWindow | undefined
let supervisor: Supervisor | undefined
let logDir = ''
let quitting = false
let stopped = false

function focusWindow(): void {
  const win = mainWindow ?? splashWindow
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

function resolveBinaries(): { apiExe: string; pgBin: string } {
  const exe = process.platform === 'win32' ? 'Pako.Api.exe' : 'Pako.Api'
  return {
    apiExe: process.env.PAKO_DESKTOP_API_EXE ?? nodePath.join(process.resourcesPath, 'api', exe),
    pgBin: process.env.PAKO_DESKTOP_PG_BIN ?? nodePath.join(process.resourcesPath, 'pg', 'bin'),
  }
}

function createSplash(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once('ready-to-show', () => win.show())
  void win.loadFile(nodePath.join(here, 'splash.html'))
  return win
}

function lockNavigation(win: BrowserWindow, apiOrigin: string): void {
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, apiOrigin)) return
    event.preventDefault()
    if (isExternalHttps(url)) void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttps(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

async function createMainWindow(apiUrl: string, launchSecret: string): Promise<BrowserWindow> {
  const apiOrigin = new URL(apiUrl).origin
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  await ses.cookies.set(buildLaunchCookie(apiOrigin, launchSecret))

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: nodePath.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  lockNavigation(win, apiOrigin)
  win.once('ready-to-show', () => {
    splashWindow?.close()
    splashWindow = undefined
    win.show()
  })
  win.on('closed', () => {
    mainWindow = undefined
  })
  await win.loadURL(apiOrigin)
  return win
}

async function fatalError(message: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'PAKO',
    message: 'PAKO could not start',
    detail: message,
    buttons: ['Open log folder', 'Close'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0 && logDir) await shell.openPath(logDir)
}

async function stopChildren(): Promise<void> {
  if (stopped || !supervisor) return
  stopped = true
  await supervisor.stopAll()
}

function registerIpc(backupDir: string, retentionDays: number): void {
  ipcMain.on(IPC.version, (event) => {
    event.returnValue = app.getVersion()
  })
  ipcMain.handle(IPC.backupNow, async () => ({ ok: false, error: 'not implemented' }))
  ipcMain.handle(IPC.listBackups, async () => [])
  ipcMain.handle(IPC.restoreFromFile, async () => ({ ok: false, error: 'not implemented' }))
  ipcMain.handle(IPC.chooseBackupDir, async () => null)
  ipcMain.handle(IPC.getBackupSettings, async () => ({
    dir: backupDir,
    retentionDays,
    lastBackupAt: null,
  }))
  ipcMain.handle(IPC.openLogFolder, async () => {
    if (logDir) await shell.openPath(logDir)
  })
}

async function start(): Promise<void> {
  const paths = resolvePaths(process.env.PAKO_DESKTOP_DATA_DIR ?? app.getPath('userData'))
  logDir = paths.logDir
  const config = await loadOrCreateConfig(paths, { safeStorage })
  registerIpc(config.backupDir, config.retentionDays)

  const { apiExe, pgBin } = resolveBinaries()
  const spawn = createLoggedSpawn(paths.logDir)
  const [pgPort, apiPort] = [await getFreePort(), await getFreePort()]

  const pg = new PostgresProcess({
    binDir: pgBin,
    dataDir: paths.pgData,
    port: pgPort,
    password: config.pgPassword,
    spawn,
  })
  const api = new ApiProcess({
    exePath: apiExe,
    port: apiPort,
    env: buildApiEnv({
      port: apiPort,
      pgPort,
      pgPassword: config.pgPassword,
      jwtKey: config.jwtKey,
      launchSecret: config.launchSecret,
    }),
    spawn,
  })
  supervisor = new Supervisor({ pg, api })
  supervisor.on('child-exited', (e) => {
    if (quitting) return
    void fatalError(`The ${e.name === 'pg' ? 'database' : 'API'} process stopped unexpectedly.`).then(
      () => app.quit(),
    )
  })

  splashWindow = createSplash()
  await pg.initIfNeeded()
  const { apiUrl } = await supervisor.startAll()
  mainWindow = await createMainWindow(apiUrl, config.launchSecret)
}

if (setupSingleInstance(app, focusWindow)) {
  app.on('window-all-closed', () => app.quit())

  app.on('before-quit', (event) => {
    quitting = true
    if (stopped || !supervisor) return
    event.preventDefault()
    void stopChildren()
      .catch(() => {})
      .finally(() => app.quit())
  })

  void app.whenReady().then(async () => {
    try {
      await start()
    } catch (err) {
      splashWindow?.close()
      splashWindow = undefined
      await stopChildren().catch(() => {})
      await fatalError(err instanceof Error ? err.message : String(err))
      app.quit()
    }
  })
}
