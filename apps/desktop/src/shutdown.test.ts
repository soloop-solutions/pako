import { describe, expect, it, vi } from 'vitest'
import { BusyGate, ShutdownController, stopAfterCloseBackup } from './shutdown'

const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(stopAll: () => Promise<void>, showFatal?: () => Promise<void>) {
  const log: string[] = []
  const timeout = { fire: () => {} }
  const controller = new ShutdownController({
    stopAll: async () => {
      log.push('stop:begin')
      await stopAll()
      log.push('stop:end')
    },
    showFatal: showFatal ?? (async () => void log.push('dialog')),
    quit: () => void log.push('quit'),
    delay: () => new Promise<void>((r) => (timeout.fire = r)),
    log: (m) => void log.push(`log:${m}`),
  })
  return { controller, log, timeout }
}

describe('shutdown', () => {
  it('Shutdown_StartupFailureShowsDialogThenQuitsAfterStopSettled', async () => {
    let finishStop = () => {}
    const { controller, log } = setup(() => new Promise<void>((r) => (finishStop = r)))
    const failed = controller.fail('boom')
    await flush()
    expect(log).toContain('dialog')
    expect(log).not.toContain('quit')
    finishStop()
    await failed
    expect(log.indexOf('dialog')).toBeLessThan(log.indexOf('quit'))
    expect(log.indexOf('stop:end')).toBeLessThan(log.indexOf('quit'))
  })

  it('Shutdown_WindowAllClosedIgnoredWhileStartingOrFatalDialogOpen', async () => {
    let closeDialog = () => {}
    const { controller, log } = setup(
      async () => {},
      () => new Promise<void>((r) => (closeDialog = r)),
    )
    controller.onWindowAllClosed()
    expect(log).not.toContain('quit')
    controller.markStarted()
    const failed = controller.fail('x')
    await flush()
    controller.onWindowAllClosed()
    expect(log).not.toContain('quit')
    closeDialog()
    await failed
    expect(log.filter((l) => l === 'quit')).toHaveLength(1)
  })

  it('Shutdown_DoubleBeforeQuitDoesNotExitMidStop', async () => {
    let finishStop = () => {}
    const { controller, log } = setup(() => new Promise<void>((r) => (finishStop = r)))
    const e1 = { preventDefault: vi.fn() }
    const e2 = { preventDefault: vi.fn() }
    controller.onBeforeQuit(e1)
    controller.onBeforeQuit(e2)
    expect(e1.preventDefault).toHaveBeenCalled()
    expect(e2.preventDefault).toHaveBeenCalled()
    expect(log.filter((l) => l === 'stop:begin')).toHaveLength(1)
    expect(log).not.toContain('quit')
    finishStop()
    await flush()
    expect(log).toContain('quit')
    const e3 = { preventDefault: vi.fn() }
    controller.onBeforeQuit(e3)
    expect(e3.preventDefault).not.toHaveBeenCalled()
  })

  it('Shutdown_HangingStopIsAbandonedAfterTimeout', async () => {
    const { controller, log, timeout } = setup(() => new Promise<void>(() => {}))
    controller.onBeforeQuit({ preventDefault: () => {} })
    await flush()
    expect(log).not.toContain('quit')
    timeout.fire()
    await flush()
    expect(log).toContain('quit')
    expect(log.some((l) => l.startsWith('log:'))).toBe(true)
    const e = { preventDefault: vi.fn() }
    controller.onBeforeQuit(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})

describe('shutdown with a running restore', () => {
  it('Shutdown_CloseDuringRestore_WaitsForTheRestoreBeforeStopping', async () => {
    const gate = new BusyGate()
    let finishRestore = () => {}
    const restoring = gate.run(() => new Promise<void>((r) => (finishRestore = r)))
    const log: string[] = []
    let delays = 0
    const controller = new ShutdownController({
      stopAll: async () => void log.push('stop'),
      showFatal: async () => {},
      quit: () => void log.push('quit'),
      delay: () => {
        delays++
        return new Promise<void>(() => {})
      },
      log: () => {},
      waitIdle: () => gate.idle(),
    })
    expect(gate.busy).toBe(true)

    controller.onBeforeQuit({ preventDefault: () => {} })
    await flush()
    expect(log).toEqual([])
    expect(delays).toBe(0)

    finishRestore()
    await restoring
    await flush()
    await flush()
    expect(log).toEqual(['stop', 'quit'])
    expect(delays).toBe(1)
    expect(gate.busy).toBe(false)
  })

  it('BusyGate_IdleResolvesImmediately_WhenNothingRuns_AndAfterFailures', async () => {
    const gate = new BusyGate()
    await gate.idle()
    await expect(
      gate.run(async () => {
        throw new Error('restore failed')
      }),
    ).rejects.toThrow('restore failed')
    expect(gate.busy).toBe(false)
    await gate.idle()
  })

  it('Shutdown_CloseBackupFailure_StillStopsChildren', async () => {
    const log: string[] = []
    await stopAfterCloseBackup({
      closeBackup: async () => {
        log.push('backup')
        throw new Error('abandoned')
      },
      stopAll: async () => void log.push('stopAll'),
      log: (m) => void log.push(`log:${m}`),
    })
    expect(log).toEqual(['backup', 'log:close backup failed: abandoned', 'stopAll'])
  })
})
