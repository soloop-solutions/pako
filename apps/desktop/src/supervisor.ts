export interface ManagedChild {
  start(): Promise<void>
  stop(): Promise<void>
  onExit(cb: (code: number | null) => void): void
}

export interface HealthyChild extends ManagedChild {
  url: string
  waitHealthy(timeoutMs: number): Promise<void>
}

export interface ChildExitedEvent {
  name: 'pg' | 'api'
  code: number | null
}

const HEALTH_TIMEOUT_MS = 60000

export class Supervisor {
  private stopping = false
  private apiPaused = false
  private restarts = { pg: 0, api: 0 }
  private listeners: ((e: ChildExitedEvent) => void)[] = []

  constructor(private readonly deps: { pg: ManagedChild; api: HealthyChild }) {
    deps.pg.onExit((code) => void this.handleExit('pg', code))
    deps.api.onExit((code) => void this.handleExit('api', code))
  }

  on(_event: 'child-exited', cb: (e: ChildExitedEvent) => void): void {
    this.listeners.push(cb)
  }

  async startAll(): Promise<{ apiUrl: string }> {
    this.stopping = false
    await this.deps.pg.start()
    await this.deps.api.start()
    await this.deps.api.waitHealthy(HEALTH_TIMEOUT_MS)
    return { apiUrl: this.deps.api.url }
  }

  async stopApi(): Promise<void> {
    this.apiPaused = true
    await this.deps.api.stop()
  }

  async startApi(): Promise<void> {
    this.apiPaused = true
    await this.deps.api.start()
    await this.deps.api.waitHealthy(HEALTH_TIMEOUT_MS)
    this.apiPaused = false
  }

  async stopAll(): Promise<void> {
    this.stopping = true
    let first: unknown
    let failed = false
    try {
      await this.deps.api.stop()
    } catch (err) {
      failed = true
      first = err
    }
    try {
      await this.deps.pg.stop()
    } catch (err) {
      if (!failed) {
        failed = true
        first = err
      }
    }
    if (failed) throw first
  }

  private async handleExit(name: 'pg' | 'api', code: number | null): Promise<void> {
    if (this.stopping || (name === 'api' && this.apiPaused)) return
    if (this.restarts[name] >= 1) {
      this.emit({ name, code })
      return
    }
    this.restarts[name]++
    try {
      await this.deps[name].start()
      if (name === 'api') await this.deps.api.waitHealthy(HEALTH_TIMEOUT_MS)
    } catch {
      this.emit({ name, code })
    }
  }

  private emit(e: ChildExitedEvent): void {
    for (const cb of this.listeners) cb(e)
  }
}
