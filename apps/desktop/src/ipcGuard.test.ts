import { describe, expect, it } from 'vitest'
import { handleRestoreRequest, isTrustedSender } from './ipcGuard'

const origin = 'http://127.0.0.1:5050'

describe('isTrustedSender', () => {
  it('accepts only frames on the API origin', () => {
    expect(isTrustedSender('http://127.0.0.1:5050/settings/backup', origin)).toBe(true)
    expect(isTrustedSender('http://127.0.0.1:5050', origin)).toBe(true)
    expect(isTrustedSender('http://127.0.0.1:5051/', origin)).toBe(false)
    expect(isTrustedSender('http://localhost:5050/', origin)).toBe(false)
    expect(isTrustedSender('https://127.0.0.1:5050/', origin)).toBe(false)
    expect(isTrustedSender('file:///C:/app/splash.html', origin)).toBe(false)
    expect(isTrustedSender('about:blank', origin)).toBe(false)
    expect(isTrustedSender('', origin)).toBe(false)
    expect(isTrustedSender(undefined, origin)).toBe(false)
    expect(isTrustedSender('http://127.0.0.1:5050/', '')).toBe(false)
  })
})

describe('handleRestoreRequest', () => {
  function deps(over: Partial<Parameters<typeof handleRestoreRequest>[0]> = {}) {
    const log: string[] = []
    return {
      log,
      d: {
        senderUrl: `${origin}/settings`,
        apiOrigin: origin,
        chooseFile: async () => {
          log.push('choose')
          return '/picked/pako-20261118-090000.pako-backup'
        },
        confirm: async (file: string) => {
          log.push(`confirm:${file}`)
          return true
        },
        restore: async (file: string) => {
          log.push(`restore:${file}`)
          return { ok: true as const, verify: { ok: true, failures: [] } }
        },
        ...over,
      },
    }
  }

  it('Restore_RefusesUntrustedSender_WithoutOpeningDialogs', async () => {
    const { d, log } = deps({ senderUrl: 'http://evil.example/' })
    expect(await handleRestoreRequest(d)).toEqual({ ok: false, error: 'Untrusted sender' })
    expect(log).toEqual([])
  })

  it('Restore_Cancelled_WhenNoFileChosen', async () => {
    const { d, log } = deps({ chooseFile: async () => null })
    expect((await handleRestoreRequest(d)).ok).toBe(false)
    expect(log).toEqual([])
  })

  it('Restore_Cancelled_WhenNotConfirmed', async () => {
    const { d, log } = deps({ confirm: async () => false })
    expect((await handleRestoreRequest(d)).ok).toBe(false)
    expect(log).toEqual(['choose'])
  })

  it('Restore_UsesTheFileFromTheNativeDialog_AfterConfirmation', async () => {
    const { d, log } = deps()
    expect(await handleRestoreRequest(d)).toEqual({ ok: true, verify: { ok: true, failures: [] } })
    expect(log).toEqual([
      'choose',
      'confirm:/picked/pako-20261118-090000.pako-backup',
      'restore:/picked/pako-20261118-090000.pako-backup',
    ])
  })

  it('Restore_ReportsThrownErrors', async () => {
    const { d } = deps({
      restore: async () => {
        throw new Error('boom')
      },
    })
    expect(await handleRestoreRequest(d)).toEqual({ ok: false, error: 'boom' })
  })
})
