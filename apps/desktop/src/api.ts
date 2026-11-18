import nodePath from 'node:path'
import type { ChildLike, SpawnFn } from './types'
import { defaultSpawn } from './spawn'

export interface ApiOptions {
  exePath: string
  port: number
  env: Record<string, string>
  spawn?: SpawnFn
  fetch?: (url: string) => Promise<{ status: number }>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface ApiEnvInput {
  port: number
  pgPort: number
  pgPassword: string
  jwtKey: string
  launchSecret: string
  dataDir: string
}

export function buildApiEnv(input: ApiEnvInput): Record<string, string> {
  return {
    Desktop__Enabled: 'true',
    ConnectionStrings__Default: `Host=127.0.0.1;Port=${input.pgPort};Database=pako;Username=postgres;Password=${input.pgPassword}`,
    Jwt__Key: input.jwtKey,
    Desktop__LaunchSecret: input.launchSecret,
    Desktop__DataDirectory: input.dataDir,
    ASPNETCORE_URLS: `http://127.0.0.1:${input.port}`,
    ASPNETCORE_ENVIRONMENT: 'Production',
    Email__Mode: 'Log',
    Email__AppBaseUrl: `http://127.0.0.1:${input.port}`,
  }
}

export class ApiProcess {
  private readonly spawn: SpawnFn
  private readonly fetchFn: (url: string) => Promise<{ status: number }>
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private child: ChildLike | undefined
  private lastExitCode: number | null = null
  private exitCallbacks: ((code: number | null) => void)[] = []

  constructor(private readonly opts: ApiOptions) {
    this.spawn = opts.spawn ?? defaultSpawn
    this.fetchFn = opts.fetch ?? ((url) => fetch(url))
    this.now = opts.now ?? Date.now
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  get url(): string {
    return `http://127.0.0.1:${this.opts.port}`
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCallbacks.push(cb)
  }

  async start(): Promise<void> {
    const child = this.spawn(this.opts.exePath, [], { env: this.opts.env, cwd: nodePath.dirname(this.opts.exePath) })
    this.child = child
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = undefined
        this.lastExitCode = code
      }
      for (const cb of this.exitCallbacks) cb(code)
    })
    child.on('error', () => {})
  }

  async waitHealthy(timeoutMs: number): Promise<void> {
    const deadline = this.now() + timeoutMs
    for (;;) {
      if (!this.child) throw new Error(`API exited with code ${this.lastExitCode} before it became healthy`)
      try {
        const res = await this.fetchFn(`${this.url}/healthz`)
        if (res.status === 200) return
      } catch {}
      if (this.now() >= deadline) {
        this.child?.kill('SIGKILL')
        throw new Error('API did not become healthy in time')
      }
      await this.sleep(250)
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve())
      child.kill('SIGTERM')
    })
  }
}
