import { describe, expect, it, vi } from 'vitest'
import { setupSingleInstance } from './singleInstance'

function fakeApp(lock: boolean) {
  let handler: (() => void) | undefined
  return {
    requestSingleInstanceLock: vi.fn(() => lock),
    on: vi.fn((_e: 'second-instance', cb: () => void) => {
      handler = cb
    }),
    quit: vi.fn(),
    fireSecond: () => handler?.(),
  }
}

describe('singleInstance', () => {
  it('singleInstance_SecondLaunchFocusesFirstWindow', () => {
    const app = fakeApp(true)
    const focusWindow = vi.fn()
    expect(setupSingleInstance(app, focusWindow)).toBe(true)
    expect(app.quit).not.toHaveBeenCalled()
    app.fireSecond()
    expect(focusWindow).toHaveBeenCalledTimes(1)
  })

  it('singleInstance_QuitsWhenLockNotObtained', () => {
    const app = fakeApp(false)
    const focusWindow = vi.fn()
    expect(setupSingleInstance(app, focusWindow)).toBe(false)
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(app.on).not.toHaveBeenCalled()
  })
})
