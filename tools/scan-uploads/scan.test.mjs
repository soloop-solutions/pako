import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { classify, scanUploads } from './scan.mjs'

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scan.mjs')

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
const HTML = '<html><script>alert(document.cookie)</script></html>'

function plant() {
  const root = mkdtempSync(path.join(tmpdir(), 'pako-scan-uploads-'))
  const company = path.join(root, 'companies', '11111111-1111-1111-1111-111111111111')
  mkdirSync(company, { recursive: true })
  writeFileSync(path.join(company, 'logo.html'), HTML)
  writeFileSync(path.join(company, 'logo.png'), HTML)
  writeFileSync(path.join(company, 'stamp.png'), PNG)
  writeFileSync(path.join(company, 'photo.JPG'), JPEG)
  writeFileSync(path.join(root, 'clean.svg'), SVG)
  writeFileSync(path.join(root, 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
  return root
}

function snapshot(root) {
  const out = {}
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out[path.relative(root, full)] = { bytes: readFileSync(full).toString('hex'), mtime: statSync(full).mtimeMs }
    }
  }
  walk(root)
  return out
}

test('ScanUploads_ListsHostileExtensionsAndMismatchedBytes_AndModifiesNothing', () => {
  const root = plant()
  try {
    const before = snapshot(root)
    const run = spawnSync(process.execPath, [cli, root], { encoding: 'utf8' })

    assert.equal(run.status, 0, run.stderr)
    const company = path.join('companies', '11111111-1111-1111-1111-111111111111')
    assert.match(run.stdout, new RegExp(`${path.join(company, 'logo.html').replace(/\\/g, '\\\\')}.*extension`))
    assert.match(run.stdout, new RegExp(`${path.join(company, 'logo.png').replace(/\\/g, '\\\\')}.*do not match`))
    assert.match(run.stdout, /evil\.svg.*event handler/)
    assert.doesNotMatch(run.stdout, /stamp\.png/)
    assert.doesNotMatch(run.stdout, /photo\.JPG/)
    assert.doesNotMatch(run.stdout, /clean\.svg/)
    assert.match(run.stdout, /6 files scanned, 3 suspect/)
    assert.deepEqual(snapshot(root), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ScanUploads_MissingDirectory_ExitsNonZeroWithAMessage', () => {
  const run = spawnSync(process.execPath, [cli, path.join(tmpdir(), 'pako-no-such-uploads-dir')], { encoding: 'utf8' })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /not a directory/)
})

test('ScanUploads_NoArgument_PrintsUsage', () => {
  const run = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /usage/i)
})

test('Classify_ChecksEachAllowedType', () => {
  assert.equal(classify('a.png', PNG), null)
  assert.equal(classify('a.jpeg', JPEG), null)
  assert.equal(classify('a.svg', Buffer.from(SVG)), null)
  assert.match(classify('a.png', PNG.subarray(0, 20)), /do not match/)
  assert.match(classify('a.jpg', PNG), /do not match/)
  assert.match(classify('a.webp', Buffer.from('RIFF')), /do not match/)
  assert.match(classify('a.svg', Buffer.from(HTML)), /not an svg/)
  assert.match(classify('a.svg', Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')), /DOCTYPE/)
  assert.match(classify('a.svg', Buffer.from('<svg><foreignObject/></svg>')), /foreignObject/)
  assert.match(classify('a.svg', Buffer.from('<svg><a href="javascript:x()"/></svg>')), /javascript:/)
  assert.match(classify('a.js', Buffer.from('x')), /extension/)
  assert.match(classify('noext', Buffer.from('x')), /extension/)
})
