import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import yauzl from 'yauzl'

export interface BackupManifest {
  appVersion: string
  schemaVersion: string
  createdAt: string
}

export const DUMP_ENTRY = 'db.dump'
export const MANIFEST_ENTRY = 'manifest.json'
export const BACKUP_EXTENSION = '.pako-backup'

const MAX_MANIFEST_BYTES = 64 * 1024
const NAME_PATTERN = /^pako-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.pako-backup$/

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export function backupStamp(now: Date): string {
  return (
    `${pad(now.getFullYear(), 4)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

export function backupFileName(now: Date, suffix = 0): string {
  return `pako-${backupStamp(now)}${suffix > 0 ? `-${suffix}` : ''}${BACKUP_EXTENSION}`
}

export function parseBackupTime(name: string): Date | null {
  const m = NAME_PATTERN.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[]
  return new Date(y!, mo! - 1, d!, h!, mi!, s!)
}

export function canRestore(
  manifest: BackupManifest,
  _appVersion: string,
  schemaVersion: string,
): { ok: true } | { ok: false; reason: 'newer-than-app' } {
  return manifest.schemaVersion > schemaVersion ? { ok: false, reason: 'newer-than-app' } : { ok: true }
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip)))
  })
}

function entryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)))
  })
}

async function withEntries<T>(
  file: string,
  visit: (zip: yauzl.ZipFile, entries: Map<string, yauzl.Entry>) => Promise<T>,
): Promise<T> {
  const zip = await openZip(file)
  try {
    const entries = await new Promise<Map<string, yauzl.Entry>>((resolve, reject) => {
      const found = new Map<string, yauzl.Entry>()
      zip.on('entry', (entry: yauzl.Entry) => {
        found.set(entry.fileName, entry)
        zip.readEntry()
      })
      zip.on('end', () => resolve(found))
      zip.on('error', reject)
      zip.readEntry()
    })
    return await visit(zip, entries)
  } finally {
    zip.close()
  }
}

function isManifest(value: unknown): value is BackupManifest {
  const v = value as Record<string, unknown> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.appVersion === 'string' &&
    typeof v.schemaVersion === 'string' &&
    typeof v.createdAt === 'string'
  )
}

export function readManifest(file: string): Promise<BackupManifest> {
  return withEntries(file, async (zip, entries) => {
    const entry = entries.get(MANIFEST_ENTRY)
    if (!entry || !entries.has(DUMP_ENTRY)) throw new Error('Not a PAKO backup')
    if (entry.uncompressedSize > MAX_MANIFEST_BYTES) throw new Error('Backup manifest is too large')
    const chunks: Buffer[] = []
    for await (const chunk of await entryStream(zip, entry)) chunks.push(chunk as Buffer)
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isManifest(parsed)) throw new Error('Backup manifest is invalid')
    return { appVersion: parsed.appVersion, schemaVersion: parsed.schemaVersion, createdAt: parsed.createdAt }
  })
}

export function extractDump(file: string, dest: string): Promise<void> {
  return withEntries(file, async (zip, entries) => {
    const entry = entries.get(DUMP_ENTRY)
    if (!entry) throw new Error('Not a PAKO backup')
    await pipeline(await entryStream(zip, entry), createWriteStream(dest, { flags: 'wx' }))
  })
}
