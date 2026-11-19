import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogWriter } from './logWriter'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pako-log-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('logWriter', () => {
  it('appends to the active file and creates the directory', () => {
    const nested = join(dir, 'logs')
    const w = createLogWriter(nested, 'api', { maxBytes: 100, keep: 3 })
    w.write(Buffer.from('hello '))
    w.write('world')
    expect(readFileSync(join(nested, 'api.log'), 'utf8')).toBe('hello world')
  })

  it('rotates when the size limit would be exceeded and keeps only the last files', () => {
    const w = createLogWriter(dir, 'api', { maxBytes: 10, keep: 3 })
    for (const c of ['aaaaaa', 'bbbbbb', 'cccccc', 'dddddd', 'eeeeee']) w.write(c)
    expect(readdirSync(dir).sort()).toEqual(['api.1.log', 'api.2.log', 'api.log'])
    expect(readFileSync(join(dir, 'api.log'), 'utf8')).toBe('eeeeee')
    expect(readFileSync(join(dir, 'api.1.log'), 'utf8')).toBe('dddddd')
    expect(readFileSync(join(dir, 'api.2.log'), 'utf8')).toBe('cccccc')
  })

  it('continues the size count of an existing file', () => {
    createLogWriter(dir, 'api', { maxBytes: 10, keep: 3 }).write('123456')
    const w = createLogWriter(dir, 'api', { maxBytes: 10, keep: 3 })
    w.write('abcdef')
    expect(readFileSync(join(dir, 'api.1.log'), 'utf8')).toBe('123456')
    expect(readFileSync(join(dir, 'api.log'), 'utf8')).toBe('abcdef')
  })
})
