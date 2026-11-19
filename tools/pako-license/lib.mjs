import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const PRIVATE_KEY_FILE = 'pako-license-private.pem'
export const PUBLIC_KEY_FILE = 'pako-license-public.pem'
export const MACHINE_CODE = /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/
const MAX_CUSTOMER = 200
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

export function normalizeMachineCode(input) {
  const code = String(input ?? '').trim().toUpperCase()
  if (!MACHINE_CODE.test(code)) {
    throw new Error(`Machine code must look like XXXX-XXXX-XXXX-XXXX (letters A-Z and digits 2-7), got "${input}"`)
  }
  return code
}

export function normalizeCustomer(input) {
  const customer = String(input ?? '').trim()
  if (customer.length === 0) throw new Error('Customer name is required')
  if (customer.length > MAX_CUSTOMER) throw new Error(`Customer name is longer than ${MAX_CUSTOMER} characters`)
  if (/[\u0000-\u001f\u007f]/.test(customer)) throw new Error('Customer name contains control characters')
  return customer
}

export function parseExpires(input, now) {
  if (input === undefined || input === null) return null
  const text = String(input).trim()
  let date
  if (DATE_ONLY.test(text)) {
    date = new Date(`${text}T23:59:59Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error(`Invalid date: ${text}`)
  } else if (DATE_TIME.test(text)) {
    date = new Date(text)
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${text}`)
  } else {
    throw new Error(`--expires must be YYYY-MM-DD or an ISO date-time with a time zone, got "${text}"`)
  }
  if (date.getTime() <= now.getTime()) throw new Error(`Expiry ${date.toISOString()} is not in the future`)
  return date
}

export function buildPayload({ machine, customer, expires, now }) {
  return {
    MachineCode: normalizeMachineCode(machine),
    Customer: normalizeCustomer(customer),
    IssuedAt: now.toISOString(),
    ExpiresAt: parseExpires(expires, now)?.toISOString() ?? null,
  }
}

export function rawPublicKey(key) {
  const publicKey = key.type === 'public' ? key : createPublicKey(key)
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')
  if (raw.length !== 32) throw new Error('Not an Ed25519 key')
  return raw
}

export function publicKeyFromRaw(raw) {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw).toString('base64url') }, format: 'jwk' })
}

export function verifyLicense(licenseKey, raw) {
  const parts = String(licenseKey).trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const payload = Buffer.from(parts[0], 'base64url')
  const signature = Buffer.from(parts[1], 'base64url')
  if (!verify(null, payload, publicKeyFromRaw(raw), signature)) return null
  return JSON.parse(payload.toString('utf8'))
}

export function issueLicense({ privateKeyPem, machine, customer, expires, now }) {
  const privateKey = createPrivateKey(privateKeyPem)
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('The private key is not an Ed25519 key')
  const payload = Buffer.from(JSON.stringify(buildPayload({ machine, customer, expires, now })), 'utf8')
  const signature = sign(null, payload, privateKey)
  const licenseKey = `${payload.toString('base64url')}.${signature.toString('base64url')}`
  if (!verifyLicense(licenseKey, rawPublicKey(privateKey))) throw new Error('Self-check failed: the issued key does not verify')
  return licenseKey
}

export function formatPublicKeyArray(raw) {
  const bytes = [...raw].map((b) => `0x${b.toString(16).padStart(2, '0')}`)
  const rows = []
  for (let i = 0; i < bytes.length; i += 16) rows.push(`        ${bytes.slice(i, i + 16).join(', ')}`)
  return rows.join(',\n')
}

export function parsePublicKeyArray(text) {
  return Buffer.from([...text.matchAll(/0x([0-9a-f]{2})/gi)].map((m) => parseInt(m[1], 16)))
}

export function findGitWorkTree(dir) {
  let current = path.resolve(dir)
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function keygen({ outDir, force = false }) {
  const dir = path.resolve(outDir)
  const workTree = findGitWorkTree(dir)
  if (workTree && !force) {
    throw new Error(`Refusing to write a private key inside the git work tree ${workTree}. Choose a folder outside any repository, or pass --force.`)
  }
  mkdirSync(dir, { recursive: true })
  const privatePath = path.join(dir, PRIVATE_KEY_FILE)
  const publicPath = path.join(dir, PUBLIC_KEY_FILE)
  for (const file of [privatePath, publicPath]) {
    if (existsSync(file)) throw new Error(`${file} already exists. Keygen never overwrites a key.`)
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  writeFileSync(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
  chmodSync(privatePath, 0o600)
  writeFileSync(publicPath, publicKey.export({ format: 'pem', type: 'spki' }), { flag: 'wx' })
  return { privatePath, publicPath, raw: rawPublicKey(publicKey) }
}
