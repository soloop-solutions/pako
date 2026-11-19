import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'
import { PRIVATE_KEY_FILE, issueLicense, keygen, parseExpires, parsePublicKeyArray, verifyLicense } from './lib.mjs'

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs')
const MACHINE = 'ABCD-EF23-4567-WXYZ'

function scratch() {
  return mkdtempSync(path.join(tmpdir(), 'pako-license-'))
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
}

test('Issue_ProducesKeyVerifiedByPublicKey', () => {
  const dir = scratch()
  try {
    const gen = runCli(['keygen', '--out', path.join(dir, 'keys')])
    assert.equal(gen.status, 0, gen.stderr)
    const raw = parsePublicKeyArray(gen.stdout)
    assert.equal(raw.length, 32)

    const issued = runCli([
      'issue',
      '--private-key',
      path.join(dir, 'keys', PRIVATE_KEY_FILE),
      '--machine',
      MACHINE.toLowerCase(),
      '--customer',
      'Çelik Ëndrra Sh.p.k.',
      '--expires',
      '2099-12-31',
    ])
    assert.equal(issued.status, 0, issued.stderr)
    const key = issued.stdout.trim()
    assert.match(key, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

    const payload = verifyLicense(key, raw)
    assert.deepEqual(Object.keys(payload), ['MachineCode', 'Customer', 'IssuedAt', 'ExpiresAt'])
    assert.equal(payload.MachineCode, MACHINE)
    assert.equal(payload.Customer, 'Çelik Ëndrra Sh.p.k.')
    assert.equal(payload.ExpiresAt, '2099-12-31T23:59:59.000Z')

    const tampered = `${Buffer.from(JSON.stringify({ ...payload, MachineCode: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' })).toString('base64url')}.${key.split('.')[1]}`
    assert.equal(verifyLicense(tampered, raw), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Issue_RejectsMalformedMachineCode', () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' })
  for (const machine of ['', 'ABCD-EF23-4567', 'ABCD-EF23-4567-WXY1', 'ABCD_EF23_4567_WXYZ', 'ABCD-EF23-4567-WXYZ-AAAA', 'ABCDEF234567WXYZ']) {
    assert.throws(
      () => issueLicense({ privateKeyPem, machine, customer: 'Acme', now: new Date() }),
      /XXXX-XXXX-XXXX-XXXX/,
      machine,
    )
  }
  const dir = scratch()
  try {
    const file = path.join(dir, 'k.pem')
    writeFileSync(file, privateKeyPem)
    const result = runCli(['issue', '--private-key', file, '--machine', 'NOT-A-CODE', '--customer', 'Acme'])
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /XXXX-XXXX-XXXX-XXXX/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Issue_WithoutExpiry_WritesNullExpiresAt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const now = new Date('2026-11-18T10:00:00.000Z')
  const key = issueLicense({ privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }), machine: MACHINE, customer: ' Acme ', now })
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')
  assert.deepEqual(verifyLicense(key, raw), { MachineCode: MACHINE, Customer: 'Acme', IssuedAt: '2026-11-18T10:00:00.000Z', ExpiresAt: null })
})

test('Issue_RejectsBadCustomerAndExpiry', () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' })
  const now = new Date('2026-11-18T10:00:00.000Z')
  assert.throws(() => issueLicense({ privateKeyPem, machine: MACHINE, customer: '   ', now }), /Customer/)
  assert.throws(() => issueLicense({ privateKeyPem, machine: MACHINE, customer: 'Acme', expires: '2026-11-17', now }), /not in the future/)
  assert.throws(() => parseExpires('2027-02-30', now), /Invalid date/)
  assert.throws(() => parseExpires('2027-01-01T00:00:00', now), /time zone/)
  assert.equal(parseExpires('2027-01-01T08:00:00+01:00', now).toISOString(), '2027-01-01T07:00:00.000Z')
})

test('Keygen_RefusesInsideGitWorkTree_UnlessForced', () => {
  const dir = scratch()
  try {
    mkdirSync(path.join(dir, 'repo', '.git'), { recursive: true })
    const inside = path.join(dir, 'repo', 'secrets')
    assert.throws(() => keygen({ outDir: inside }), /git work tree/)
    const forced = keygen({ outDir: inside, force: true })
    assert.equal(readFileSync(forced.privatePath, 'utf8').startsWith('-----BEGIN PRIVATE KEY-----'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Keygen_WritesPrivateKeyMode0600_AndNeverOverwrites', () => {
  const dir = scratch()
  try {
    const { privatePath } = keygen({ outDir: dir })
    if (process.platform !== 'win32') assert.equal(statSync(privatePath).mode & 0o777, 0o600)
    assert.throws(() => keygen({ outDir: dir }), /already exists/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Cli_Keygen_RefusesInsideThisRepository', () => {
  const inside = path.join(path.dirname(cli), 'should-not-exist')
  const result = runCli(['keygen', '--out', inside])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /git work tree/)
  assert.throws(() => statSync(inside))
})
