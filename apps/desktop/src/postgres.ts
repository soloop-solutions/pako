import { promises as nodeFs } from 'node:fs'
import net from 'node:net'
import nodePath from 'node:path'
import type { ChildLike, PathModule, SpawnFn } from './types'
import { defaultSpawn } from './spawn'

export interface PgFs {
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  rm(path: string): Promise<void>
  mkdir(path: string): Promise<void>
}

export interface PostgresOptions {
  binDir: string
  dataDir: string
  port: number
  password: string
  spawn?: SpawnFn
  fs?: PgFs
  pathModule?: PathModule
  isProcessAlive?: (pid: number) => boolean
  probe?: (port: number) => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  readyTimeoutMs?: number
  database?: string
}

const realFs: PgFs = {
  exists: async (p) => {
    try {
      await nodeFs.access(p)
      return true
    } catch {
      return false
    }
  },
  readFile: (p) => nodeFs.readFile(p, 'utf8'),
  writeFile: (p, d) => nodeFs.writeFile(p, d, { encoding: 'utf8', mode: 0o600 }),
  rm: (p) => nodeFs.rm(p, { force: true }),
  mkdir: async (p) => {
    await nodeFs.mkdir(p, { recursive: true })
  },
}

function realIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function realProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function waitForExit(child: ChildLike): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => resolve(code))
    child.on('error', reject)
  })
}

export class PostgresProcess {
  private readonly spawn: SpawnFn
  private readonly fs: PgFs
  private readonly path: PathModule
  private readonly isProcessAlive: (pid: number) => boolean
  private readonly probe: (port: number) => Promise<boolean>
  private readonly sleep: (ms: number) => Promise<void>
  private readonly readyTimeoutMs: number
  private readonly now: () => number
  private child: ChildLike | undefined
  private lastExitCode: number | null = null
  private exitCallbacks: ((code: number | null) => void)[] = []

  constructor(private readonly opts: PostgresOptions) {
    this.spawn = opts.spawn ?? defaultSpawn
    this.fs = opts.fs ?? realFs
    this.path = opts.pathModule ?? nodePath
    this.isProcessAlive = opts.isProcessAlive ?? realIsProcessAlive
    this.probe = opts.probe ?? realProbe
    this.sleep = opts.sleep ?? realSleep
    this.now = opts.now ?? Date.now
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 30000
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCallbacks.push(cb)
  }

  private bin(name: string): string {
    return this.path.join(this.opts.binDir, name)
  }

  async initIfNeeded(): Promise<void> {
    const { dataDir, password } = this.opts
    if (await this.fs.exists(this.path.join(dataDir, 'PG_VERSION'))) return
    const pwFile = this.path.join(this.path.dirname(dataDir), 'pg-init.pwfile')
    await this.fs.mkdir(this.path.dirname(dataDir))
    await this.fs.writeFile(pwFile, password)
    try {
      const child = this.spawn(this.bin('initdb'), [
        '-D',
        dataDir,
        '--encoding=UTF8',
        '--locale=C',
        '--username=postgres',
        '--auth=scram-sha-256',
        `--pwfile=${pwFile}`,
      ])
      const code = await waitForExit(child)
      if (code !== 0) throw new Error(`initdb exited with code ${code}`)
    } finally {
      await this.fs.rm(pwFile)
    }
  }

  private sameDir(a: string, b: string): boolean {
    const norm = (v: string) => v.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    return norm(a) === norm(b)
  }

  private async runCode(name: string, args: string[], env?: Record<string, string>): Promise<number | null> {
    const child = this.spawn(this.bin(name), args, env ? { env } : undefined)
    return waitForExit(child)
  }

  private async runTool(name: string, args: string[], env?: Record<string, string>): Promise<void> {
    const child = this.spawn(this.bin(name), args, env ? { env } : undefined)
    const code = await waitForExit(child)
    if (code !== 0) throw new Error(`${name} exited with code ${code}`)
  }

  private async recoverPidFile(): Promise<void> {
    const pidFile = this.path.join(this.opts.dataDir, 'postmaster.pid')
    if (!(await this.fs.exists(pidFile))) return
    const lines = (await this.fs.readFile(pidFile)).split(/\r?\n/)
    const pid = Number.parseInt(lines[0] ?? '', 10)
    const alive = Number.isFinite(pid) && this.isProcessAlive(pid)
    const ours =
      alive &&
      (this.sameDir(lines[1] ?? '', this.opts.dataDir) ||
        (await this.runCode('pg_ctl', ['status', '-D', this.opts.dataDir])) === 0)
    if (ours) {
      await this.runTool('pg_ctl', ['stop', '-D', this.opts.dataDir, '-m', 'fast', '-w'])
      return
    }
    await this.fs.rm(pidFile)
  }

  private async ensureDatabase(): Promise<void> {
    const { port, password, dataDir } = this.opts
    const db = this.opts.database ?? 'pako'
    const sqlFile = this.path.join(this.path.dirname(dataDir), 'pg-create-db.sql')
    const sql =
      `SELECT 'CREATE DATABASE "${db}" ENCODING ''UTF8'' TEMPLATE template0'\n` +
      `WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${db}')\n` +
      `\\gexec\n`
    await this.fs.writeFile(sqlFile, sql)
    try {
      const args = [
        '-h',
        '127.0.0.1',
        '-p',
        String(port),
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        sqlFile,
      ]
      const deadline = this.now() + this.readyTimeoutMs
      for (;;) {
        this.assertRunning()
        if ((await this.runCode('psql', args, { PGPASSWORD: password })) === 0) return
        if (this.now() >= deadline) {
          throw new Error('Postgres did not accept connections in time to create the database')
        }
        await this.sleep(250)
      }
    } finally {
      await this.fs.rm(sqlFile)
    }
  }

  async start(): Promise<void> {
    await this.recoverPidFile()
    const { dataDir, port } = this.opts
    const child = this.spawn(this.bin('postgres'), [
      '-D',
      dataDir,
      '-p',
      String(port),
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      'shared_buffers=128MB',
      '-c',
      'max_connections=50',
    ])
    this.child = child
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = undefined
        this.lastExitCode = code
      }
      for (const cb of this.exitCallbacks) cb(code)
    })
    child.on('error', () => {})
    await this.waitReady()
    await this.ensureDatabase()
  }

  private assertRunning(): void {
    if (!this.child) throw new Error(`Postgres exited with code ${this.lastExitCode} before it became ready`)
  }

  private async waitReady(): Promise<void> {
    const attempts = Math.max(1, Math.ceil(this.readyTimeoutMs / 250))
    for (let i = 0; i < attempts; i++) {
      this.assertRunning()
      if (await this.probe(this.opts.port)) return
      await this.sleep(250)
    }
    this.assertRunning()
    this.child?.kill()
    throw new Error('Postgres did not become ready in time')
  }

  async stop(): Promise<void> {
    if (!this.child) return
    const stopper = this.spawn(this.bin('pg_ctl'), [
      'stop',
      '-D',
      this.opts.dataDir,
      '-m',
      'fast',
    ])
    await waitForExit(stopper).catch(() => null)
  }
}
