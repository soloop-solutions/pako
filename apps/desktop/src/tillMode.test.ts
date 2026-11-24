import { describe, expect, it } from 'vitest'
import {
  discoverServers,
  isSetupSender,
  normalizeServer,
  probeServer,
  readMode,
  resolveStartMode,
  subnetCandidates,
  tillRedirect,
  writeMode,
  type FetchFn,
  type ModeFs,
} from './tillMode'

const memoryFs = () => {
  const files = new Map<string, string>()
  const fs: ModeFs = {
    readFile: async (p) => {
      const v = files.get(p)
      if (v === undefined) throw new Error('ENOENT')
      return v
    },
    writeFile: async (p, d) => void files.set(p, d),
    mkdir: async () => undefined,
  }
  return { files, fs }
}

describe('mode file', () => {
  it('round-trips main and till, and ignores a broken file', async () => {
    const { files, fs } = memoryFs()
    expect(await readMode('/d', fs)).toBeNull()
    await writeMode('/d', { mode: 'till', server: 'http://192.168.1.10:5300' }, fs)
    expect(await readMode('/d', fs)).toEqual({ mode: 'till', server: 'http://192.168.1.10:5300' })
    await writeMode('/d', { mode: 'main' }, fs)
    expect(await readMode('/d', fs)).toEqual({ mode: 'main' })
    files.set([...files.keys()][0]!, '{ not json')
    expect(await readMode('/d', fs)).toBeNull()
  })
})

describe('resolveStartMode', () => {
  it('keeps an existing install as the main PC and asks only a fresh one', () => {
    expect(resolveStartMode(null, true)).toEqual({ mode: 'main' })
    expect(resolveStartMode(null, false)).toBe('ask')
    expect(resolveStartMode({ mode: 'till', server: 'http://a:5300' }, false)).toEqual({ mode: 'till', server: 'http://a:5300' })
  })
})

describe('normalizeServer', () => {
  it('accepts what people type for the main PC', () => {
    expect(normalizeServer('192.168.1.10')).toBe('http://192.168.1.10:5300')
    expect(normalizeServer(' 192.168.1.10:5400 ')).toBe('http://192.168.1.10:5400')
    expect(normalizeServer('http://kasa-pc:5300/device')).toBe('http://kasa-pc:5300')
    expect(normalizeServer('KASA-PC')).toBe('http://kasa-pc:5300')
  })

  it('refuses what is not an address', () => {
    expect(normalizeServer('')).toBeNull()
    expect(normalizeServer('ftp://x')).toBeNull()
    expect(normalizeServer('http://user:pw@x')).toBeNull()
    expect(normalizeServer('not an address at all')).toBeNull()
  })
})

const fakeFetch = (pako: Record<string, string>): FetchFn => async (url) => {
  const origin = new URL(url).origin
  if (!(origin in pako)) throw new Error('unreachable')
  return { ok: true, json: async () => ({ status: 'ok', app: 'pako', machine: pako[origin] }) }
}

describe('finding the main PC', () => {
  it('probes the till port and knows PAKO by its healthz', async () => {
    expect(await probeServer('http://192.168.1.10:5300', fakeFetch({ 'http://192.168.1.10:5300': 'KASA' }))).toEqual({ url: 'http://192.168.1.10:5300', machine: 'KASA' })
    expect(await probeServer('http://192.168.1.11:5300', fakeFetch({}))).toBeNull()
    const other: FetchFn = async () => ({ ok: true, json: async () => ({ status: 'ok' }) })
    expect(await probeServer('http://192.168.1.12:5300', other)).toBeNull()
  })

  it('gives up on an address that does not answer in time', async () => {
    const hang: FetchFn = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    expect(await probeServer('http://192.168.1.13:5300', hang, 10)).toBeNull()
  })

  it('lists the other addresses of each /24 network', () => {
    const list = subnetCandidates(['192.168.1.20'])
    expect(list).toHaveLength(253)
    expect(list).not.toContain('192.168.1.20')
    expect(list[0]).toBe('192.168.1.1')
  })

  it('scans the networks and lists every main PC found', async () => {
    const found = await discoverServers({
      addresses: ['192.168.1.20'],
      fetch: fakeFetch({ 'http://192.168.1.10:5300': 'KASA', 'http://192.168.1.3:5300': 'ZYRA' }),
    })
    expect(found).toEqual([
      { url: 'http://192.168.1.3:5300', machine: 'ZYRA' },
      { url: 'http://192.168.1.10:5300', machine: 'KASA' },
    ])
  })
})

describe('tillRedirect', () => {
  const server = 'http://192.168.1.10:5300'
  it('sends a till that is not connected to the connect page', () => {
    expect(tillRedirect(`${server}/login?next=%2Fdevice`, server)).toBe(`${server}/device/connect`)
    expect(tillRedirect(`${server}/`, server)).toBe(`${server}/device/connect`)
  })
  it('leaves the till and other hosts alone', () => {
    expect(tillRedirect(`${server}/device`, server)).toBeNull()
    expect(tillRedirect(`${server}/pos/till/r1`, server)).toBeNull()
    expect(tillRedirect('http://elsewhere:5300/login', server)).toBeNull()
  })
})

describe('isSetupSender', () => {
  it('trusts only the local setup page', () => {
    expect(isSetupSender('file:///C:/Program%20Files/PAKO/resources/app.asar/dist/setup.html')).toBe(true)
    expect(isSetupSender('http://192.168.1.10:5300/setup.html')).toBe(false)
    expect(isSetupSender(undefined)).toBe(false)
  })
})
