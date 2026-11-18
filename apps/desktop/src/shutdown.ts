export interface ShutdownDeps {
  stopAll(): Promise<void>
  showFatal(message: string): Promise<void>
  quit(): void
  delay(): Promise<void>
  log(message: string): void
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
      const stop = this.deps.stopAll().catch((err) => {
        this.deps.log(`stop failed: ${err instanceof Error ? err.message : String(err)}`)
      })
      const timeout = this.deps.delay().then(() => {
        this.deps.log('stop timed out, abandoning')
      })
      this.stopPromise = Promise.race([stop, timeout]).then(() => {
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
