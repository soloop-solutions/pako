import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const desktopDir = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')

const electronStub = `
const calls = []
const record = (name) => (...args) => { calls.push(name); return undefined }
process.on('exit', () => { process.stdout.write('CALLS:' + calls.join(',') + '\\n') })
const app = {
  isPackaged: true,
  requestSingleInstanceLock: () => { calls.push('requestSingleInstanceLock'); return true },
  on: record('app.on'),
  quit: record('app.quit'),
  getVersion: () => '0.0.0',
  getPath: () => '/nonexistent',
  whenReady: () => { calls.push('whenReady'); return new Promise(() => {}) },
}
class BrowserWindow {}
const noop = {}
module.exports = { app, BrowserWindow, dialog: noop, ipcMain: noop, Menu: noop, powerSaveBlocker: noop, safeStorage: noop, session: noop, shell: noop }
`

let root = ''
let appDir = ''

beforeAll(() => {
  root = mkdtempSync(nodePath.join(tmpdir(), 'pako-bundle-'))
  appDir = nodePath.join(root, 'app')
  execFileSync(process.execPath, ['scripts/bundle.mjs', appDir], { cwd: desktopDir, stdio: 'pipe' })
  const stubDir = nodePath.join(root, 'node_modules', 'electron')
  mkdirSync(stubDir, { recursive: true })
  writeFileSync(nodePath.join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }))
  writeFileSync(nodePath.join(stubDir, 'index.js'), electronStub)
}, 60000)

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('bundled output', () => {
  it('loads the main bundle under node and reaches app.whenReady', () => {
    const run = spawnSync(process.execPath, [nodePath.join(appDir, 'main.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
    })
    expect(run.stderr).not.toMatch(/Error/)
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('CALLS:requestSingleInstanceLock,app.on,app.on,app.on,whenReady')
  })

  it('loads the preload bundle with only the sandboxed electron require', () => {
    const code = readFileSync(nodePath.join(appDir, 'preload.cjs'), 'utf8')
    const required: string[] = []
    const exposed: Record<string, unknown> = {}
    const electron = {
      contextBridge: { exposeInMainWorld: (key: string, value: unknown) => (exposed[key] = value) },
      ipcRenderer: { sendSync: () => '1.2.3', invoke: () => Promise.resolve() },
    }
    const sandboxRequire = (name: string) => {
      required.push(name)
      if (name !== 'electron') throw new Error(`module not available in a sandboxed preload: ${name}`)
      return electron
    }
    const module = { exports: {} }
    vm.runInNewContext(`(function (require, module, exports) {${code}\n})`, {})(sandboxRequire, module, module.exports)
    expect(required).toEqual(['electron'])
    expect(exposed.pakoDesktop).toMatchObject({ isDesktop: true, version: '1.2.3' })
  })

  it('copies the splash page next to the bundles', () => {
    expect(readFileSync(nodePath.join(appDir, 'splash.html'), 'utf8')).toContain('<')
  })
})
