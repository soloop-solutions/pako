#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ALLOWED = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg'])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isPng(b) {
  return (
    b.length >= 45 &&
    b.subarray(0, 8).equals(PNG_SIGNATURE) &&
    b.toString('latin1', 12, 16) === 'IHDR' &&
    b.toString('latin1', b.length - 8, b.length - 4) === 'IEND'
  )
}

function isJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return false
  return b.subarray(Math.max(2, b.length - 1024)).indexOf(Buffer.from([0xff, 0xd9])) >= 0
}

function isWebp(b) {
  if (b.length < 20 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return false
  if (!['VP8 ', 'VP8L', 'VP8X'].includes(b.toString('latin1', 12, 16))) return false
  return b.readUInt32LE(4) + 8 <= b.length
}

function svgProblem(b) {
  const text = b.toString('utf8')
  const body = text
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trimStart()
  if (/<!DOCTYPE/i.test(text)) return 'svg has a DOCTYPE'
  if (!/^<(?:[\w.-]+:)?svg[\s/>]/.test(body)) return 'bytes are not an svg document'
  if (/<script/i.test(text)) return 'svg contains a script element'
  if (/foreignObject/i.test(text)) return 'svg contains foreignObject'
  if (/[\s"'/]on[a-z]+\s*=/i.test(text)) return 'svg contains an event handler attribute'
  if (/javascript:/i.test(text.replace(/[\s\u0000-\u001f]+/g, ''))) return 'svg contains a javascript: URL'
  return null
}

export function classify(file, bytes) {
  const ext = path.extname(file).slice(1).toLowerCase()
  if (!ALLOWED.has(ext)) return `extension .${ext || '(none)'} is not an allowed image type`
  if (ext === 'png') return isPng(bytes) ? null : 'bytes do not match .png'
  if (ext === 'jpg' || ext === 'jpeg') return isJpeg(bytes) ? null : `bytes do not match .${ext}`
  if (ext === 'webp') return isWebp(bytes) ? null : 'bytes do not match .webp'
  return svgProblem(bytes)
}

export function scanUploads(root) {
  const findings = []
  let scanned = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        scanned++
        const reason = classify(entry.name, readFileSync(full))
        if (reason) findings.push({ file: path.relative(root, full), reason })
      } else {
        scanned++
        findings.push({ file: path.relative(root, full), reason: 'not a regular file' })
      }
    }
  }
  walk(root)
  return { scanned, findings }
}

function main(argv) {
  const root = argv[0]
  if (!root) {
    process.stderr.write('usage: node tools/scan-uploads/scan.mjs <uploads directory>\n')
    return 2
  }
  let isDir = false
  try {
    isDir = statSync(root).isDirectory()
  } catch {}
  if (!isDir) {
    process.stderr.write(`${root} is not a directory\n`)
    return 2
  }
  const { scanned, findings } = scanUploads(root)
  process.stdout.write(`Read-only scan of ${path.resolve(root)} (nothing is changed or deleted)\n`)
  for (const f of findings) process.stdout.write(`SUSPECT ${f.file}: ${f.reason}\n`)
  process.stdout.write(`${scanned} files scanned, ${findings.length} suspect\n`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
