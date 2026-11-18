import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdtempSync, promises as fs, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { REQUIRED_EXECUTABLES, assertPinned, fetchPostgres, keptEntryPath } from './fetch-postgres.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const yazl = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'))('yazl')

function scratch() {
  return mkdtempSync(path.join(tmpdir(), 'pako-fetch-pg-'))
}

async function makeZip(file, entries) {
  const zip = new yazl.ZipFile()
  for (const [name, content] of Object.entries(entries)) zip.addBuffer(Buffer.from(content), name)
  zip.end()
  await new Promise((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(file)).on('close', resolve).on('error', reject)
  })
  const bytes = await fs.readFile(file)
  return createHash('sha256').update(bytes).digest('hex')
}

function fullDistribution() {
  const entries = {
    'pgsql/lib/plpgsql.dll': 'dll',
    'pgsql/share/timezonesets/Default': 'tz',
    'pgsql/doc/index.html': 'doc',
    'pgsql/pgAdmin 4/runtime/pgAdmin4.exe': 'pgadmin',
    'pgsql/StackBuilder/bin/stackbuilder.exe': 'sb',
    'pgsql/symbols/postgres.pdb': 'pdb',
    'pgsql/include/libpq-fe.h': 'h',
    'pgsql/bin/libpq.dll': 'libpq',
    'pgsql/bin/stackbuilder.exe': 'sb',
    'pgsql/bin/wxbase3212u_vc_x64_custom.dll': 'wx',
  }
  for (const name of REQUIRED_EXECUTABLES) entries[`pgsql/bin/${name}.exe`] = name
  return entries
}

const copyDownload = (source) => async (_url, dest) => fs.copyFile(source, dest)

test('Fetch_FailsOnChecksumMismatch', async () => {
  const dir = scratch()
  try {
    const fake = path.join(dir, 'fake.zip')
    await makeZip(fake, fullDistribution())
    const cacheDir = path.join(dir, 'cache')
    const outDir = path.join(dir, 'out', 'pg')
    const release = { version: 'x', file: 'pg.zip', url: 'https://example.invalid/pg.zip', sha256: 'a'.repeat(64) }

    await assert.rejects(
      fetchPostgres({ release, cacheDir, outDir, download: copyDownload(fake), log: () => {} }),
      /SHA-256 mismatch/,
    )

    assert.deepEqual(readdirSync(cacheDir), [])
    assert.equal(existsSync(outDir), false)
    assert.equal(existsSync(`${outDir}.staging`), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Fetch_ExtractsBinLibShare_AndStripsTheRest', async () => {
  const dir = scratch()
  try {
    const fake = path.join(dir, 'fake.zip')
    const sha256 = await makeZip(fake, fullDistribution())
    const outDir = path.join(dir, 'out', 'pg')
    const release = { version: 'x', file: 'pg.zip', url: 'https://example.invalid/pg.zip', sha256 }
    let downloads = 0
    const download = async (url, dest) => {
      downloads++
      await fs.copyFile(fake, dest)
    }

    await fetchPostgres({ release, cacheDir: path.join(dir, 'cache'), outDir, download, log: () => {} })
    await fetchPostgres({ release, cacheDir: path.join(dir, 'cache'), outDir, download, log: () => {} })

    assert.equal(downloads, 1)
    assert.deepEqual(readdirSync(outDir).sort(), ['bin', 'lib', 'share'])
    for (const name of REQUIRED_EXECUTABLES) assert.equal(existsSync(path.join(outDir, 'bin', `${name}.exe`)), true)
    assert.equal(existsSync(path.join(outDir, 'bin', 'libpq.dll')), true)
    assert.equal(existsSync(path.join(outDir, 'lib', 'plpgsql.dll')), true)
    assert.deepEqual(readdirSync(path.join(outDir, 'bin')).filter((n) => /stackbuilder|^wx/i.test(n)), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Fetch_FailsWhenARequiredExecutableIsMissing', async () => {
  const dir = scratch()
  try {
    const entries = fullDistribution()
    delete entries['pgsql/bin/pg_restore.exe']
    delete entries['pgsql/bin/psql.exe']
    const fake = path.join(dir, 'fake.zip')
    const sha256 = await makeZip(fake, entries)
    const outDir = path.join(dir, 'out', 'pg')
    const release = { version: 'x', file: 'pg.zip', url: 'https://example.invalid/pg.zip', sha256 }

    await assert.rejects(
      fetchPostgres({ release, cacheDir: path.join(dir, 'cache'), outDir, download: copyDownload(fake), log: () => {} }),
      /missing required executables: psql\.exe, pg_restore\.exe/,
    )
    assert.equal(existsSync(outDir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Fetch_RejectsZipSlipEntries', async () => {
  assert.throws(() => keptEntryPath('pgsql/bin/../../evil.exe'), /unsafe/)
  assert.throws(() => keptEntryPath('pgsql\\bin\\evil.exe'), /unsafe/)
  assert.equal(keptEntryPath('pgsql/doc/x.html'), null)
  assert.equal(keptEntryPath('other/bin/x.exe'), null)
  assert.equal(keptEntryPath('pgsql/bin/psql.exe'), 'bin/psql.exe')
  assert.equal(keptEntryPath('pgsql/bin/stackbuilder.exe'), null)
  assert.equal(keptEntryPath('pgsql/bin/wxmsw3212u_core_vc_x64_custom.dll'), null)
})

test('Fetch_RefusesWithoutAPinnedChecksum', () => {
  assert.throws(() => assertPinned({ file: 'pg.zip', sha256: 'REPLACE_ME' }), /no valid SHA-256/)
  assert.throws(() => assertPinned({ file: 'pg.zip', sha256: '' }), /no valid SHA-256/)
})
