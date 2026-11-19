export interface ShutdownDeps {
  stopAll(): Promise<void>
  showFatal(message: string): Promise<void>
  quit(): void
  delay(): Promise<void>
  log(message: string): void
  waitIdle?(): Promise<void>
}

export class BusyGate {
  private count = 0
  private waiters: (() => void)[] = []

  get busy(): boolean {
    return this.count > 0
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.count++
    try {
      return await fn()
    } finally {
      this.count--
      if (this.count === 0) for (const resolve of this.waiters.splice(0)) resolve()
    }
  }

  idle(): Promise<void> {
    if (this.count === 0) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}

export async function stopAfterCloseBackup(deps: {
  closeBackup(): Promise<unknown>
  stopAll(): Promise<void>
  log(message: string): void
}): Promise<void> {
  try {
    await deps.closeBackup()
  } catch (err) {
    deps.log(`close backup failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await deps.stopAll()
  }
}

export const SHUTDOWN_TIMEOUT_MS = 20000

export class ShutdownController {
  private starting = true
  private fatalOpen = false
  private stopComplete = false
  private stopPromise: Promise<void> | undefined

  constructor(private readonly deps: ShutdownDeps) {}

  markStarted(): void {
    this.starting = false
  }

  requestStop(): Promise<void> {
    if (!this.stopPromise) {
      const begin = () => {
        const stop = this.deps.stopAll().catch((err) => {
          this.deps.log(`stop failed: ${err instanceof Error ? err.message : String(err)}`)
        })
        const timeout = this.deps.delay().then(() => {
          this.deps.log('stop timed out, abandoning')
        })
        return Promise.race([stop, timeout])
      }
      const stopped = this.deps.waitIdle ? this.deps.waitIdle().then(begin) : begin()
      this.stopPromise = stopped.then(() => {
        this.stopComplete = true
      })
    }
    return this.stopPromise
  }

  onBeforeQuit(event: { preventDefault(): void }): void {
    if (this.stopComplete) return
    event.preventDefault()
    void this.requestStop().then(() => this.deps.quit())
  }

  onWindowAllClosed(): void {
    if (this.starting || this.fatalOpen) return
    this.deps.quit()
  }

  async fail(message: string): Promise<void> {
    const stopped = this.requestStop()
    this.fatalOpen = true
    try {
      await this.deps.showFatal(message)
    } finally {
      this.fatalOpen = false
    }
    await stopped
    this.deps.quit()
  }
}
