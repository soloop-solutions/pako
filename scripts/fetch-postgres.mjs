import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const yauzl = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'))('yauzl')

export const POSTGRES_RELEASE = {
  version: '16.16-1',
  file: 'postgresql-16.16-1-windows-x64-binaries.zip',
  url: 'https://get.enterprisedb.com/postgresql/postgresql-16.16-1-windows-x64-binaries.zip',
  sha256: '5c0d06f3d26a929ecb36dd931409f1e51a4181355794a259b90aae8bffc57a9f',
}

export const REQUIRED_EXECUTABLES = ['postgres', 'initdb', 'pg_ctl', 'pg_isready', 'psql', 'pg_dump', 'pg_restore']
export const ZIP_ROOT = 'pgsql/'
export const KEPT_DIRS = ['bin', 'lib', 'share']
const STRIPPED_FILES = /^bin\/(stackbuilder\.exe|wx[^/]*\.dll)$/i
export const DEFAULT_CACHE_DIR = path.join(repoRoot, '.cache', 'postgres')
export const DEFAULT_OUT_DIR = path.join(repoRoot, 'apps', 'desktop', 'resources', 'pg')

export function assertPinned(release) {
  if (!/^[0-9a-f]{64}$/.test(release.sha256 ?? '')) {
    throw new Error(`fetch-postgres: no valid SHA-256 pinned for ${release.file}. Refusing to continue.`)
  }
}

export async function sha256File(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

export async function httpDownload(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`fetch-postgres: download of ${url} failed with HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest, { flags: 'wx' }))
}

export function keptEntryPath(entryName) {
  if (entryName.includes('\\') || entryName.includes('\0')) throw new Error(`fetch-postgres: unsafe zip entry ${entryName}`)
  if (!entryName.startsWith(ZIP_ROOT)) return null
  const rel = entryName.slice(ZIP_ROOT.length)
  const parts = rel.split('/').filter((p) => p.length > 0)
  if (parts.some((p) => p === '..' || p === '.') || path.isAbsolute(rel)) throw new Error(`fetch-postgres: unsafe zip entry ${entryName}`)
  if (parts.length === 0 || !KEPT_DIRS.includes(parts[0])) return null
  const kept = parts.join('/')
  return STRIPPED_FILES.test(kept) ? null : kept
}

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, zip) =>
      err ? reject(err) : resolve(zip),
    )
  })
}

export async function extractKept(zipFile, destDir) {
  const zip = await openZip(zipFile)
  await new Promise((resolve, reject) => {
    const fail = (err) => {
      zip.close()
      reject(err)
    }
    zip.on('error', fail)
    zip.on('end', resolve)
    zip.on('entry', (entry) => {
      let rel
      try {
        rel = keptEntryPath(entry.fileName)
      } catch (err) {
        fail(err)
        return
      }
      if (rel === null) {
        zip.readEntry()
        return
      }
      const target = path.join(destDir, ...rel.split('/'))
      if (entry.fileName.endsWith('/')) {
        fs.mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail)
        return
      }
      fs.mkdir(path.dirname(target), { recursive: true })
        .then(
          () =>
            new Promise((done, bad) =>
              zip.openReadStream(entry, (err, stream) =>
                err ? bad(err) : pipeline(stream, createWriteStream(target, { flags: 'wx' })).then(done, bad),
              ),
            ),
        )
        .then(() => zip.readEntry(), fail)
    })
    zip.readEntry()
  })
}

export async function missingExecutables(pgDir, platform = 'win32') {
  const suffix = platform === 'win32' ? '.exe' : ''
  const missing = []
  for (const name of REQUIRED_EXECUTABLES) {
    try {
      const stat = await fs.stat(path.join(pgDir, 'bin', name + suffix))
      if (!stat.isFile()) missing.push(name + suffix)
    } catch {
      missing.push(name + suffix)
    }
  }
  return missing
}

export async function fetchPostgres({
  release = POSTGRES_RELEASE,
  cacheDir = DEFAULT_CACHE_DIR,
  outDir = DEFAULT_OUT_DIR,
  download = httpDownload,
  platform = 'win32',
  log = (message) => console.log(message),
} = {}) {
  assertPinned(release)
  await fs.mkdir(cacheDir, { recursive: true })
  const zipPath = path.join(cacheDir, release.file)

  let cached = false
  try {
    cached = (await sha256File(zipPath)) === release.sha256
    if (!cached) {
      log(`fetch-postgres: cached ${release.file} does not match the pinned SHA-256, downloading again`)
      await fs.rm(zipPath, { force: true })
    }
  } catch {}

  if (!cached) {
    const partial = `${zipPath}.part`
    await fs.rm(partial, { force: true })
    log(`fetch-postgres: downloading ${release.url}`)
    try {
      await download(release.url, partial)
      const actual = await sha256File(partial)
      if (actual !== release.sha256) {
        throw new Error(
          `fetch-postgres: SHA-256 mismatch for ${release.file}: expected ${release.sha256}, got ${actual}. The download was discarded.`,
        )
      }
      await fs.rename(partial, zipPath)
    } finally {
      await fs.rm(partial, { force: true })
    }
  }

  const staging = `${outDir}.staging`
  await fs.rm(staging, { recursive: true, force: true })
  try {
    await extractKept(zipPath, staging)
    const missing = await missingExecutables(staging, platform)
    if (missing.length > 0) {
      throw new Error(`fetch-postgres: ${release.file} is missing required executables: ${missing.join(', ')}`)
    }
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(path.dirname(outDir), { recursive: true })
    await fs.rename(staging, outDir)
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
  log(`fetch-postgres: PostgreSQL ${release.version} ready in ${outDir}`)
  return outDir
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  fetchPostgres().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
