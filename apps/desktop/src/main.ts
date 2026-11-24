import { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, safeStorage, session, shell } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import { networkInterfaces } from 'node:os'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BackupInfo, BackupResult, RestoreResult } from '@pako/shared'
import { ApiProcess, buildApiEnv } from './api'
import {
  applyRetention,
  createBackup,
  dropPreviousDatabase,
  listBackups,
  newestBackupAt,
  putBackPrevious,
  readSchemaVersion,
  restoreBackup,
  settleVerify,
  sweepStaleTemp,
  type PgConnection,
  type VerifyResult,
} from './backup'
import { loadOrCreateConfig, saveApiPort, saveBackupDir, saveTillNetwork, type DesktopConfig } from './config'
import { handleRestoreRequest, isTrustedSender } from './ipcGuard'
import { IPC } from './ipcChannels'
import {
  LAUNCH_COOKIE_NAME,
  buildLaunchCookie,
  isAllowedNavigation,
  isAllowedPermission,
  isAllowedRequest,
  isExternalHttps,
} from './navPolicy'
import { resolvePaths, type DesktopPaths } from './paths'
import { chooseApiPort, getFreePort, isPortFree } from './ports'
import { PostgresProcess } from './postgres'
import { CATCH_UP_DELAY_MS, startScheduler, type Scheduler } from './scheduler'
import { BackupQueue } from './backupQueue'
import { BusyGate, SHUTDOWN_TIMEOUT_MS, ShutdownController, stopAfterCloseBackup } from './shutdown'
import { setupSingleInstance } from './singleInstance'
import { createLoggedSpawn } from './spawn'
import { Supervisor } from './supervisor'
import { ensureFirewallRule, lanAddresses, portTakenMessage, TillNetworkController, type ExecFn } from './tillNetwork'
import {
  discoverServers,
  isSetupSender,
  normalizeServer,
  probeServer,
  readMode,
  resolveStartMode,
  tillRedirect,
  writeMode,
  type FetchFn,
  type StoredMode,
} from './tillMode'
import type { SpawnFn } from './types'
import { decideAfterStartFailure, markVersion, NEWER_SCHEMA_DIALOG, prepareUpgrade, readInstalledVersion } from './upgrade'

const here = nodePath.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | undefined
let splashWindow: BrowserWindow | undefined
let supervisor: Supervisor | undefined
let scheduler: Scheduler | undefined
let logDir = ''

interface BackupContext {
  paths: DesktopPaths
  config: DesktopConfig
  appVersion: string
  workDir: string
  tools: { pgBinDir: string; connection: PgConnection; spawn: SpawnFn }
}

const NOT_VERIFIED: VerifyResult = { ok: false, failures: [] }

const backupQueue = new BackupQueue()

let keepAwakeId: number | undefined

// While tills depend on this PC, Windows must not put it to sleep (the screen may still turn off).
function keepAwake(on: boolean): void {
  if (on && keepAwakeId === undefined) keepAwakeId = powerSaveBlocker.start('prevent-app-suspension')
  if (!on && keepAwakeId !== undefined) {
    powerSaveBlocker.stop(keepAwakeId)
    keepAwakeId = undefined
  }
}

const execQuiet: ExecFn = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
      resolve({ code, stdout: String(stdout ?? '') })
    })
  })

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref()
  })

async function pathExists(p: string): Promise<boolean> {
  try {
    await nodeFs.access(p)
    return true
  } catch {
    return false
  }
}

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
  ses.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(isAllowedPermission(permission, details.requestingUrl, apiOrigin)),
  )
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    isAllowedPermission(permission, requestingOrigin, apiOrigin),
  )
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
  win.on('close', (event) => {
    if (!restoreGate.busy) return
    event.preventDefault()
    void dialog.showMessageBox(win, {
      type: 'info',
      title: 'PAKO',
      message: 'A restore is in progress',
      detail: 'PAKO can be closed when the restore has finished.',
      buttons: ['OK'],
    })
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

const restoreGate = new BusyGate()

const shutdown = new ShutdownController({
  stopAll: () =>
    stopAfterCloseBackup({
      closeBackup: async () => {
        if (!scheduler) return
        scheduler.stop()
        await scheduler.onClose()
      },
      stopAll: async () => {
        if (supervisor) await supervisor.stopAll()
      },
      log: (message) => console.error(`[backup] ${message}`),
    }),
  showFatal,
  quit: () => app.quit(),
  delay: () => delay(SHUTDOWN_TIMEOUT_MS),
  log: (message) => console.error(`[shutdown] ${message}`),
  waitIdle: () => restoreGate.idle(),
})

async function withPostgres<T>(pg: PostgresProcess, fn: () => Promise<T>): Promise<T> {
  const exited = new Promise<void>((resolve) => pg.onExit(() => resolve()))
  await pg.start()
  try {
    return await fn()
  } finally {
    await pg.stop()
    await Promise.race([exited, delay(30000)])
  }
}

async function fetchSchemaVersion(apiUrl: string): Promise<string> {
  const res = await fetch(`${apiUrl}/healthz`)
  if (res.status !== 200) throw new Error(`healthz returned ${res.status}`)
  const body = (await res.json()) as { schemaVersion?: unknown }
  if (typeof body.schemaVersion !== 'string') throw new Error('healthz returned no schema version')
  return body.schemaVersion
}

async function fetchAuditVerify(apiUrl: string, launchSecret: string): Promise<VerifyResult> {
  const res = await fetch(`${apiUrl}/api/desktop/audit-verify`, {
    headers: { Cookie: `${LAUNCH_COOKIE_NAME}=${launchSecret}`, Accept: 'application/json' },
  })
  if (res.status !== 200) throw new Error(`audit verify returned ${res.status}`)
  const body = (await res.json()) as VerifyResult
  if (typeof body.ok !== 'boolean' || !Array.isArray(body.failures)) {
    throw new Error('audit verify returned an invalid response')
  }
  return { ok: body.ok, failures: body.failures }
}

function registerIpc(ctx: BackupContext, apiUrl: string, launchSecret: string, tills: TillNetworkController): void {
  const apiOrigin = new URL(apiUrl).origin
  const { config } = ctx
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => isTrustedSender(event.senderFrame?.url, apiOrigin)
  const guarded =
    <T>(fn: () => Promise<T>) =>
    async (event: IpcMainInvokeEvent): Promise<T> => {
      if (!trusted(event)) throw new Error('Untrusted sender')
      return fn()
    }

  const schemaVersion = () =>
    fetchSchemaVersion(apiUrl).catch(() => readSchemaVersion({ ...ctx.tools, workDir: ctx.workDir }))

  const runBackup = (callerSignal?: AbortSignal): Promise<BackupInfo> =>
    backupQueue.backup(async (signal) => {
      await sweepStaleTemp(config.backupDir, new Date())
      const info = await createBackup({
        ...ctx.tools,
        destDir: config.backupDir,
        appVersion: ctx.appVersion,
        schemaVersion: await schemaVersion(),
        now: new Date(),
        signal,
      })
      await applyRetention(config.backupDir, config.retentionDays, new Date()).catch((err) =>
        console.error(`[backup] retention failed: ${errorText(err)}`),
      )
      return info
    }, callerSignal)

  const apiControl = {
    stopApi: () => supervisor!.stopApi(),
    startApi: () => supervisor!.startApi(),
  }

  const confirmKeep = async (failedCompanies: number): Promise<boolean> => {
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'PAKO',
      message: `The restored data's audit chain is broken for ${failedCompanies} ${failedCompanies === 1 ? 'company' : 'companies'}`,
      detail:
        'The audit trail in this backup does not verify, so its records may have been changed outside PAKO. ' +
        'You can keep the restored data, or put back the data you had before the restore.',
      buttons: ['Keep the restored data', 'Put back the previous data'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    return response === 0
  }

  const runRestore = (file: string): Promise<RestoreResult> =>
    restoreGate.run(() => backupQueue.exclusive(async () => {
      const restored = await restoreBackup({
        ...ctx.tools,
        file,
        backupDir: config.backupDir,
        workDir: ctx.workDir,
        appVersion: ctx.appVersion,
        schemaVersion: await schemaVersion(),
        now: new Date(),
        ...apiControl,
        verifyChain: () => fetchAuditVerify(apiUrl, launchSecret),
      })
      const result = await settleVerify(restored, {
        confirmKeep,
        keep: () => dropPreviousDatabase(ctx.tools),
        putBack: () => putBackPrevious({ ...ctx.tools, ...apiControl }),
      })
      const apiUp = await fetchSchemaVersion(apiUrl).then(
        () => true,
        () => false,
      )
      if (!result.ok && !apiUp) void shutdown.fail(result.error)
      return result
    }))

  ipcMain.on(IPC.version, (event) => {
    event.returnValue = trusted(event) ? app.getVersion() : ''
  })
  ipcMain.handle(
    IPC.backupNow,
    guarded(async (): Promise<BackupResult> => {
      try {
        return { ok: true, info: await runBackup() }
      } catch (err) {
        return { ok: false, error: errorText(err) }
      }
    }),
  )
  ipcMain.handle(
    IPC.listBackups,
    guarded(() => listBackups(config.backupDir)),
  )
  ipcMain.handle(IPC.restoreFromFile, (event) =>
    handleRestoreRequest({
      senderUrl: event.senderFrame?.url,
      apiOrigin,
      chooseFile: async () => {
        const options: Electron.OpenDialogOptions = {
          title: 'Restore from backup',
          defaultPath: config.backupDir,
          properties: ['openFile'],
          filters: [{ name: 'PAKO backup', extensions: ['pako-backup'] }],
        }
        const picked = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
        return picked.canceled ? null : (picked.filePaths[0] ?? null)
      },
      confirm: async (file) => {
        const options: Electron.MessageBoxOptions = {
          type: 'warning',
          title: 'PAKO',
          message: 'Replace all current data with this backup?',
          detail:
            `${nodePath.basename(file)}\n\n` +
            'Everything entered after that backup was made will be replaced. A safety backup of the current data is taken first.',
          buttons: ['Restore', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        }
        const { response } = mainWindow
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options)
        return response === 0
      },
      restore: runRestore,
    }),
  )
  ipcMain.handle(
    IPC.chooseBackupDir,
    guarded(async () => {
      const options: Electron.OpenDialogOptions = {
        title: 'Backup folder',
        defaultPath: config.backupDir,
        properties: ['openDirectory', 'createDirectory'],
      }
      const picked = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      const dir = picked.canceled ? undefined : picked.filePaths[0]
      if (!dir) return null
      const probe = nodePath.join(dir, `.pako-write-test-${randomBytes(4).toString('hex')}`)
      try {
        await nodeFs.writeFile(probe, '')
      } catch {
        throw new Error('PAKO cannot write to this folder. Choose another one.')
      } finally {
        await nodeFs.rm(probe, { force: true })
      }
      await saveBackupDir(ctx.paths, dir)
      config.backupDir = dir
      return dir
    }),
  )
  ipcMain.handle(
    IPC.getBackupSettings,
    guarded(async () => ({
      dir: config.backupDir,
      retentionDays: config.retentionDays,
      lastBackupAt: (await newestBackupAt(config.backupDir))?.toISOString() ?? null,
      lastAutoBackupFailure: scheduler?.status().lastFailure ?? null,
    })),
  )
  ipcMain.handle(
    IPC.getTillNetwork,
    guarded(async () => tills.status()),
  )
  ipcMain.handle(IPC.setTillNetwork, async (event, settings: unknown) => {
    if (!trusted(event)) throw new Error('Untrusted sender')
    const s = settings as { enabled?: unknown; port?: unknown } | null
    if (!s || typeof s.enabled !== 'boolean' || typeof s.port !== 'number') throw new Error('Invalid till network settings')
    // set() puts the API back the way it was when a restart fails; only if that fails too is
    // PAKO left without an API, and then it stops like any other API failure.
    return tills.set({ enabled: s.enabled, port: s.port }).catch((err: unknown) => {
      void shutdown.fail(`The API could not be restarted: ${errorText(err)}`)
      return { ok: false as const, error: errorText(err) }
    })
  })
  ipcMain.handle(
    IPC.openLogFolder,
    guarded(async () => {
      if (logDir) await shell.openPath(logDir)
    }),
  )

  scheduler = startScheduler({
    now: () => new Date(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    lastBackupAt: () => newestBackupAt(config.backupDir),
    backup: async (signal) => {
      await runBackup(signal)
    },
    abortAll: () => backupQueue.abortBackups(),
    idle: () => backupQueue.idle(),
    log: (message) => console.error(`[backup] ${message}`),
    catchUpDelayMs: CATCH_UP_DELAY_MS,
    isRestoring: () => restoreGate.busy,
  })
}

async function offerUpgradeRollback(ctx: BackupContext, pg: PostgresProcess, backup: BackupInfo): Promise<void> {
  splashWindow?.close()
  splashWindow = undefined
  if (supervisor) await supervisor.stopAll().catch(() => {})
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'PAKO',
    message: `PAKO ${ctx.appVersion} could not start after the update`,
    detail:
      `The database could not be prepared for this version. Your data from before the update is in the backup ${backup.file}.\n\n` +
      'You can restore it now, then install the previous version of PAKO again and contact support.',
    buttons: ['Restore the backup', 'Open log folder', 'Close'],
    defaultId: 0,
    cancelId: 2,
  })
  if (response === 1 && logDir) await shell.openPath(logDir)
  if (response === 0) {
    const result = await withPostgres(pg, async () =>
      restoreBackup({
        ...ctx.tools,
        file: backup.file,
        backupDir: nodePath.dirname(backup.file),
        workDir: ctx.workDir,
        appVersion: ctx.appVersion,
        schemaVersion: await readSchemaVersion({ ...ctx.tools, workDir: ctx.workDir }),
        now: new Date(),
        stopApi: async () => {},
        startApi: async () => {},
        verifyChain: async () => NOT_VERIFIED,
      }),
    ).catch((err): RestoreResult => ({ ok: false, error: errorText(err) }))
    await dialog.showMessageBox({
      type: result.ok ? 'info' : 'error',
      title: 'PAKO',
      message: result.ok ? 'The data from before the update was restored' : 'The backup could not be restored',
      detail: result.ok
        ? 'Install the previous version of PAKO to keep working with it.'
        : `${result.error}\n\nThe backup file is still at ${backup.file}.`,
      buttons: ['Close'],
    })
  }
  shutdown.markStarted()
  app.quit()
}

async function refuseNewerSchema(): Promise<void> {
  splashWindow?.close()
  splashWindow = undefined
  if (supervisor) await supervisor.stopAll().catch(() => {})
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'PAKO',
    message: NEWER_SCHEMA_DIALOG.message,
    detail: NEWER_SCHEMA_DIALOG.detail,
    buttons: [...NEWER_SCHEMA_DIALOG.buttons],
    defaultId: 1,
    cancelId: 1,
  })
  if (response === 0 && logDir) await shell.openPath(logDir)
  shutdown.markStarted()
  app.quit()
}

// ---- Till mode: what this PC is, and a till PC's window onto the main PC ----

interface SetupHandlers {
  chooseMain?: () => Promise<void>
  chooseTill?: (address: string) => Promise<{ ok: true } | { ok: false; error: string; server?: string }>
  changeServer?: () => Promise<void>
  retry?: () => Promise<void>
}

let setupHandlers: SetupHandlers = {}
let setupIpcRegistered = false

const fetchHealth: FetchFn = (url, init) => fetch(url, init)

function registerSetupIpc(): void {
  if (setupIpcRegistered) return
  setupIpcRegistered = true
  const guard =
    <A extends unknown[], T>(fn: (...args: A) => Promise<T>) =>
    async (event: IpcMainInvokeEvent, ...args: A): Promise<T> => {
      if (!isSetupSender(event.senderFrame?.url)) throw new Error('Untrusted sender')
      return fn(...args)
    }
  ipcMain.handle(IPC.setupChooseMain, guard(async () => setupHandlers.chooseMain?.()))
  ipcMain.handle(IPC.setupDiscover, guard(async () => discoverServers({ addresses: lanAddresses(networkInterfaces()), fetch: fetchHealth })))
  ipcMain.handle(
    IPC.setupChooseTill,
    guard(async (address: unknown) =>
      typeof address === 'string' && setupHandlers.chooseTill
        ? setupHandlers.chooseTill(address)
        : { ok: false as const, error: 'badAddress' },
    ),
  )
  ipcMain.handle(IPC.setupChangeServer, guard(async () => setupHandlers.changeServer?.()))
  ipcMain.handle(IPC.setupRetry, guard(async () => setupHandlers.retry?.()))
}

const SETUP_PAGE = () => nodePath.join(here, 'setup.html')

// Finds and checks a main PC typed or picked on the setup page.
async function checkServer(address: string): Promise<{ ok: true; server: string } | { ok: false; error: string; server?: string }> {
  const server = normalizeServer(address)
  if (!server) return { ok: false, error: 'badAddress' }
  return (await probeServer(server, fetchHealth)) ? { ok: true, server } : { ok: false, error: 'notFound', server }
}

// First start on a PC with no data: main PC or till? Null when the window is closed unanswered.
function askMode(paths: DesktopPaths): Promise<StoredMode | null> {
  registerSetupIpc()
  return new Promise((resolve) => {
    let settled = false
    const win = new BrowserWindow({
      width: 640,
      height: 620,
      resizable: false,
      show: false,
      title: 'PAKO',
      autoHideMenuBar: true,
      webPreferences: { preload: nodePath.join(here, 'setupPreload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    const done = async (mode: StoredMode | null) => {
      if (settled) return
      settled = true
      setupHandlers = {}
      if (mode) await writeMode(paths.dataDir, mode)
      resolve(mode)
      if (!win.isDestroyed()) win.close()
    }
    setupHandlers = {
      chooseMain: () => done({ mode: 'main' }),
      chooseTill: async (address) => {
        const checked = await checkServer(address)
        if (!checked.ok) return checked
        await done({ mode: 'till', server: checked.server })
        return { ok: true }
      },
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => void done(null))
    void win.loadFile(SETUP_PAGE(), { query: { view: 'choose' } })
  })
}

// A till PC: no database, no API. One window on the main PC's till, connected as a device
// (POS setup → Devices → the short code), which starts with Windows and comes back by itself
// when the main PC is off for a while.
async function startTill(paths: DesktopPaths, initialServer: string): Promise<void> {
  let server = initialServer
  let retryTimer: NodeJS.Timeout | undefined
  registerSetupIpc()
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true })

  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setSpellCheckerEnabled(false)
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, server) })
  })

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'PAKO',
    autoHideMenuBar: true,
    webPreferences: {
      preload: nodePath.join(here, 'setupPreload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  })
  mainWindow = win
  win.once('ready-to-show', () => {
    splashWindow?.close()
    splashWindow = undefined
    win.maximize()
    win.show()
  })
  win.on('closed', () => {
    mainWindow = undefined
    if (retryTimer) clearInterval(retryTimer)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, server)) event.preventDefault()
  })
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, server)) event.preventDefault()
  })
  const redirect = (_event: unknown, url: string) => {
    const next = tillRedirect(url, server)
    if (next) void win.loadURL(next)
  }
  win.webContents.on('did-navigate', redirect)
  win.webContents.on('did-navigate-in-page', redirect)
  win.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    // -3: aborted by a newer navigation, not a failure.
    if (isMainFrame && code !== -3 && url.startsWith(server)) showOffline()
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    }
  })

  const stopRetry = () => {
    if (retryTimer) clearInterval(retryTimer)
    retryTimer = undefined
  }
  async function openServer(): Promise<void> {
    if (await probeServer(server, fetchHealth)) {
      stopRetry()
      await win.loadURL(`${server}/device`)
    } else showOffline()
  }
  function showOffline(): void {
    if (win.isDestroyed()) return
    void win.loadFile(SETUP_PAGE(), { query: { view: 'offline', server } })
    if (!retryTimer)
      retryTimer = setInterval(() => {
        void probeServer(server, fetchHealth).then((ok) => {
          if (ok && !win.isDestroyed()) {
            stopRetry()
            void win.loadURL(`${server}/device`)
          }
        })
      }, 5000)
  }

  setupHandlers = {
    retry: openServer,
    changeServer: async () => {
      stopRetry()
      await win.loadFile(SETUP_PAGE(), { query: { view: 'till' } })
    },
    chooseTill: async (address) => {
      const checked = await checkServer(address)
      if (!checked.ok) return checked
      server = checked.server
      await writeMode(paths.dataDir, { mode: 'till', server })
      void openServer()
      return { ok: true }
    },
  }

  shutdown.markStarted()
  await openServer()
}

async function start(): Promise<void> {
  const paths = resolvePaths(devOverride('PAKO_DESKTOP_DATA_DIR') ?? app.getPath('userData'))
  logDir = paths.logDir

  // Main PC or till? Asked once, on a PC with no data yet; an existing install stays the main PC.
  const stored = await readMode(paths.dataDir)
  let mode = resolveStartMode(stored, await pathExists(nodePath.join(paths.pgData, 'PG_VERSION')))
  if (mode === 'ask') {
    const chosen = await askMode(paths)
    if (!chosen) {
      shutdown.markStarted()
      app.quit()
      return
    }
    mode = chosen
  } else if (!stored) await writeMode(paths.dataDir, mode)
  if (mode.mode === 'till') {
    splashWindow = createSplash()
    await startTill(paths, mode.server)
    return
  }
  const config = await loadOrCreateConfig(paths, { safeStorage })
  const launchSecret = randomBytes(32).toString('hex')
  const appVersion = app.getVersion()

  const { apiExe, pgBin } = resolveBinaries()
  const spawn = createLoggedSpawn(paths.logDir)
  const apiPort = await chooseApiPort({
    saved: config.apiPort,
    isFree: isPortFree,
    getFree: getFreePort,
    persist: (port) => saveApiPort(paths, port),
  })
  let pgPort = await getFreePort()
  while (pgPort === apiPort || pgPort === config.tillPort) pgPort = await getFreePort()

  // "Allow tills on this network": a port another program holds must not stop PAKO from starting;
  // the tills stay off and Settings says why.
  let tillPort: number | undefined
  let tillError: string | null = null
  if (config.tillNetwork) {
    if (config.tillPort !== apiPort && (await isPortFree(config.tillPort, '0.0.0.0'))) tillPort = config.tillPort
    else tillError = portTakenMessage(config.tillPort)
  }

  const pg = new PostgresProcess({
    binDir: pgBin,
    dataDir: paths.pgData,
    port: pgPort,
    password: config.pgPassword,
    spawn,
  })
  const apiEnv = (till: number | undefined) =>
    buildApiEnv({
      port: apiPort,
      pgPort,
      pgPassword: config.pgPassword,
      jwtKey: config.jwtKey,
      launchSecret,
      dataDir: paths.dataDir,
      tillPort: till,
    })
  const api = new ApiProcess({
    exePath: apiExe,
    port: apiPort,
    env: apiEnv(tillPort),
    spawn,
  })
  const ctx: BackupContext = {
    paths,
    config,
    appVersion,
    workDir: nodePath.join(paths.dataDir, 'tmp'),
    tools: { pgBinDir: pgBin, connection: { port: pgPort, password: config.pgPassword, database: 'pako' }, spawn },
  }

  splashWindow = createSplash()
  for (const dir of new Set([config.backupDir, paths.backupsDefault, ctx.workDir])) {
    await sweepStaleTemp(dir, new Date()).catch(() => [])
  }
  const hasDatabase = await pathExists(nodePath.join(paths.pgData, 'PG_VERSION'))
  await pg.initIfNeeded()
  const installedVersion = await readInstalledVersion(paths.dataDir)
  const upgrade = await prepareUpgrade({
    dataDir: paths.dataDir,
    appVersion,
    hasDatabase,
    backup: () =>
      withPostgres(pg, async () => {
        const options = {
          ...ctx.tools,
          appVersion: installedVersion || appVersion,
          schemaVersion: await readSchemaVersion({ ...ctx.tools, workDir: ctx.workDir }),
          now: new Date(),
        }
        try {
          return await createBackup({ ...options, destDir: config.backupDir })
        } catch (err) {
          if (config.backupDir === paths.backupsDefault) throw err
          console.error(`[backup] pre-upgrade backup to ${config.backupDir} failed: ${errorText(err)}`)
          return createBackup({ ...options, destDir: paths.backupsDefault })
        }
      }),
  })

  supervisor = new Supervisor({ pg, api })
  supervisor.on('child-exited', (e) => {
    void shutdown.fail(`The ${e.name === 'pg' ? 'database' : 'API'} process stopped unexpectedly.`)
  })

  let apiUrl: string
  try {
    ;({ apiUrl } = await supervisor.startAll())
  } catch (err) {
    const decision = decideAfterStartFailure(upgrade, err)
    if (decision.action === 'offer-restore') {
      await offerUpgradeRollback(ctx, pg, decision.backup)
      return
    }
    if (decision.action === 'newer-schema') {
      await refuseNewerSchema()
      return
    }
    throw err
  }
  await markVersion(paths.dataDir, appVersion)
  const tills = new TillNetworkController({
    initial: { enabled: config.tillNetwork, port: config.tillPort },
    startedPort: tillPort,
    startError: tillError,
    addresses: () => lanAddresses(networkInterfaces()),
    isPortFree: (port) => isPortFree(port, '0.0.0.0'),
    reservedPorts: () => [apiPort, pgPort],
    ensureFirewall: () => ensureFirewallRule({ platform: process.platform, exec: execQuiet, apiExe }),
    save: async (enabled, port) => {
      await saveTillNetwork(paths, enabled, port)
      config.tillNetwork = enabled
      config.tillPort = port
    },
    restartApi: (till) =>
      backupQueue.exclusive(async () => {
        await supervisor!.stopApi()
        api.setEnv(apiEnv(till))
        await supervisor!.startApi()
      }),
    keepAwake,
    isBusy: () => restoreGate.busy,
  })
  registerIpc(ctx, apiUrl, launchSecret, tills)
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
