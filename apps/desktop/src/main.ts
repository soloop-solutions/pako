import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiProcess, buildApiEnv } from './api'
import { loadOrCreateConfig } from './config'
import { IPC } from './ipcChannels'
import {
  buildLaunchCookie,
  isAllowedNavigation,
  isAllowedRequest,
  isExternalHttps,
} from './navPolicy'
import { resolvePaths } from './paths'
import { getFreePort } from './ports'
import { PostgresProcess } from './postgres'
import { SHUTDOWN_TIMEOUT_MS, ShutdownController } from './shutdown'
import { setupSingleInstance } from './singleInstance'
import { createLoggedSpawn } from './spawn'
import { Supervisor } from './supervisor'

const here = nodePath.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | undefined
let splashWindow: BrowserWindow | undefined
let supervisor: Supervisor | undefined
let logDir = ''

function focusWindow(): void {
  const win = mainWindow ?? splashWindow
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

function devOverride(name: string): string | undefined {
  return app.isPackaged ? undefined : process.env[name]
}

function resolveBinaries(): { apiExe: string; pgBin: string } {
  const exe = process.platform === 'win32' ? 'Pako.Api.exe' : 'Pako.Api'
  return {
    apiExe: devOverride('PAKO_DESKTOP_API_EXE') ?? nodePath.join(process.resourcesPath, 'api', exe),
    pgBin: devOverride('PAKO_DESKTOP_PG_BIN') ?? nodePath.join(process.resourcesPath, 'pg', 'bin'),
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
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, apiOrigin)) event.preventDefault()
  })
  win.webContents.on('will-frame-navigate', (event) => {
    if (!isAllowedNavigation(event.url, apiOrigin)) event.preventDefault()
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
  ses.setSpellCheckerEnabled(false)
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, apiOrigin) })
  })
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
      devTools: !app.isPackaged,
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

async function showFatal(message: string): Promise<void> {
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

const shutdown = new ShutdownController({
  stopAll: async () => {
    if (supervisor) await supervisor.stopAll()
  },
  showFatal,
  quit: () => app.quit(),
  delay: () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref()
    }),
  log: (message) => console.error(`[shutdown] ${message}`),
})

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
  const paths = resolvePaths(devOverride('PAKO_DESKTOP_DATA_DIR') ?? app.getPath('userData'))
  logDir = paths.logDir
  const config = await loadOrCreateConfig(paths, { safeStorage })
  const launchSecret = randomBytes(32).toString('hex')
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
      launchSecret,
    }),
    spawn,
  })
  supervisor = new Supervisor({ pg, api })
  supervisor.on('child-exited', (e) => {
    void shutdown.fail(`The ${e.name === 'pg' ? 'database' : 'API'} process stopped unexpectedly.`)
  })

  splashWindow = createSplash()
  await pg.initIfNeeded()
  const { apiUrl } = await supervisor.startAll()
  mainWindow = await createMainWindow(apiUrl, launchSecret)
  shutdown.markStarted()
}

if (setupSingleInstance(app, focusWindow)) {
  app.on('window-all-closed', () => shutdown.onWindowAllClosed())
  app.on('before-quit', (event) => shutdown.onBeforeQuit(event))

  void app.whenReady().then(async () => {
    if (app.isPackaged) Menu.setApplicationMenu(null)
    try {
      await start()
    } catch (err) {
      await shutdown.fail(err instanceof Error ? err.message : String(err))
      splashWindow?.close()
      splashWindow = undefined
    }
  })
}
