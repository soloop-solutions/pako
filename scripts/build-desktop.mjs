import { spawn } from 'node:child_process'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fetchPostgres } from './fetch-postgres.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function buildPaths(root = repoRoot) {
  const desktopDir = path.join(root, 'apps', 'desktop')
  return {
    root,
    apiProject: path.join(root, 'backend', 'Pako.Api', 'Pako.Api.csproj'),
    apiOut: path.join(desktopDir, 'resources', 'api'),
    webDist: path.join(root, 'apps', 'web', 'dist'),
    pgOut: path.join(desktopDir, 'resources', 'pg'),
    desktopDir,
    licenseKeyFile: path.join(root, 'backend', 'Pako.Domain', 'Desktop', 'LicensePublicKey.cs'),
  }
}

export const DEV_LICENSE_PUBLIC_KEY = [
  0xd7, 0x76, 0x0c, 0x04, 0x32, 0x7c, 0x14, 0xde, 0xcb, 0xc5, 0xdb, 0xd3, 0x94, 0x31, 0x1e, 0xa4,
  0x22, 0xb3, 0xb7, 0x57, 0x3c, 0x34, 0xc9, 0x8f, 0xa3, 0x35, 0x75, 0x0b, 0x84, 0xd5, 0x2d, 0xdd,
]

export function parseLicensePublicKey(source) {
  const body = /new\s+byte\[\]\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''
  return [...body.matchAll(/0x([0-9a-fA-F]{1,2})/g)].map((m) => Number.parseInt(m[1], 16))
}

export function licenseKeyGuard({ source, env }) {
  const key = parseLicensePublicKey(source)
  if (key.length !== 32) throw new Error(`LicensePublicKey.cs must hold a 32 bytes Ed25519 public key, found ${key.length} bytes.`)
  if (key.some((b, i) => b !== DEV_LICENSE_PUBLIC_KEY[i])) return null
  const message =
    'build-desktop: LicensePublicKey.cs still holds the development license public key. Keys from the dev pair ' +
    'would unlock every installer. Run tools/pako-license keygen and paste the production key (docs/DESKTOP.md, Release gates).'
  if (env.PAKO_ALLOW_DEV_LICENSE_KEY !== '1') throw new Error(`${message} For an internal test build only, set PAKO_ALLOW_DEV_LICENSE_KEY=1.`)
  return (
    '\n' +
    '************************************************************************\n' +
    '*  WARNING: building with the development license public key           *\n' +
    '*  (PAKO_ALLOW_DEV_LICENSE_KEY=1). Never ship this installer.          *\n' +
    '************************************************************************\n'
  )
}

export const VC_RUNTIME_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']

export function vcRuntimeDir(env) {
  if (env.PAKO_VCRUNTIME_DIR) return env.PAKO_VCRUNTIME_DIR
  if (env.VCToolsRedistDir) return path.join(env.VCToolsRedistDir, 'x64', 'Microsoft.VC143.CRT')
  return null
}

export function dotnetPublishArgs(paths) {
  return ['publish', paths.apiProject, '-r', 'win-x64', '--self-contained', '-c', 'Release', '-o', paths.apiOut]
}

export function webBuildEnv(env) {
  return { ...env, VITE_API_BASE_URL: '/' }
}

export function pnpmCommand(env, execPath = process.execPath) {
  const script = env.npm_execpath
  if (script && /pnpm\.(c?js|mjs)$/.test(script)) return { command: execPath, prefix: [script] }
  return { command: 'pnpm', prefix: [] }
}

export function electronBuilderArgs() {
  return ['exec', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '--config', 'electron-builder.yml']
}

export function cscLinkIsPath(value) {
  if (/^https?:/i.test(value)) return false
  return /\.(pfx|p12)$/i.test(value) || /^([A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/]|~)/.test(value)
}

export function signingEnv(env) {
  const link = env.WIN_CSC_LINK
  if (!link) {
    return {
      env: { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
      warning:
        '\n' +
        '************************************************************************\n' +
        '*  WARNING: WIN_CSC_LINK is not set. The installer will NOT be signed.  *\n' +
        '*  Windows SmartScreen will warn users. Internal and pilot use only.     *\n' +
        '************************************************************************\n',
    }
  }
  if (!env.WIN_CSC_KEY_PASSWORD) {
    throw new Error('WIN_CSC_LINK is set but WIN_CSC_KEY_PASSWORD is not. Set both to sign, or neither to build unsigned.')
  }
  return { env: { ...env }, warning: null }
}

export function planSteps({
  paths,
  env,
  run,
  fetchPg = fetchPostgres,
  files = defaultFiles,
  log = console.log,
  readLicenseKey = (file) => readFileSync(file, 'utf8'),
}) {
  const licenseWarning = licenseKeyGuard({ source: readLicenseKey(paths.licenseKeyFile), env })
  if (licenseWarning) log(licenseWarning)
  const crtDir = vcRuntimeDir(env)
  if (!crtDir) {
    throw new Error(
      'build-desktop: the bundled PostgreSQL needs the Visual C++ runtime (vcruntime140.dll, vcruntime140_1.dll, msvcp140.dll). ' +
        'Set PAKO_VCRUNTIME_DIR to the folder holding them, or run from a Visual Studio developer prompt (VCToolsRedistDir). See docs/DESKTOP.md.',
    )
  }
  const signing = signingEnv(env)
  const pnpm = pnpmCommand(env)
  const runPnpm = (args, opts) => run(pnpm.command, [...pnpm.prefix, ...args], opts)
  return [
    {
      name: 'publish API (win-x64, self-contained)',
      run: async () => {
        await files.remove(paths.apiOut)
        await run('dotnet', dotnetPublishArgs(paths), { cwd: paths.root, env })
        await files.requireFile(path.join(paths.apiOut, 'Pako.Api.exe'))
      },
    },
    {
      name: 'build web (VITE_API_BASE_URL=/, same origin)',
      run: () => runPnpm(['--filter', 'web', 'exec', 'vite', 'build'], { cwd: paths.root, env: webBuildEnv(env) }),
    },
    {
      name: 'copy web build into the API wwwroot',
      run: async () => {
        await files.requireFile(path.join(paths.webDist, 'index.html'))
        const wwwroot = path.join(paths.apiOut, 'wwwroot')
        await files.remove(wwwroot)
        await files.copyDir(paths.webDist, wwwroot)
      },
    },
    {
      name: 'fetch PostgreSQL',
      run: () => fetchPg({ outDir: paths.pgOut }),
    },
    {
      name: 'add the Visual C++ runtime to PostgreSQL',
      run: async () => {
        for (const dll of VC_RUNTIME_DLLS) await files.copyFile(path.join(crtDir, dll), path.join(paths.pgOut, 'bin', dll))
      },
    },
    {
      name: 'bundle desktop app',
      run: () => runPnpm(['--filter', '@pako/desktop', 'build'], { cwd: paths.root, env }),
    },
    {
      name: 'electron-builder (NSIS installer)',
      run: async () => {
        if (signing.warning) log(signing.warning)
        else if (cscLinkIsPath(signing.env.WIN_CSC_LINK)) await files.requireFile(signing.env.WIN_CSC_LINK)
        await runPnpm(electronBuilderArgs(), { cwd: paths.desktopDir, env: signing.env })
      },
    },
  ]
}

export async function runSteps(steps, log = console.log) {
  for (const [index, step] of steps.entries()) {
    log(`\n[build-desktop ${index + 1}/${steps.length}] ${step.name}`)
    try {
      await step.run()
    } catch (err) {
      throw new Error(`build-desktop: step "${step.name}" failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export const defaultFiles = {
  remove: (p) => fs.rm(p, { recursive: true, force: true }),
  copyDir: (from, to) => fs.cp(from, to, { recursive: true }),
  copyFile: (from, to) => fs.copyFile(from, to),
  requireFile: async (p) => {
    if (!existsSync(p)) throw new Error(`expected file is missing: ${p}`)
  },
}

export function runProcess(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.on('error', (err) => reject(new Error(`could not start ${command}: ${err.message}`)))
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`)),
    )
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  Promise.resolve()
    .then(() => runSteps(planSteps({ paths: buildPaths(), env: process.env, run: runProcess })))
    .then(
      () => console.log('\nbuild-desktop: done. Installer is in apps/desktop/dist.'),
      (err) => {
        console.error(`\n${err.message}`)
        process.exit(1)
      },
    )
}
