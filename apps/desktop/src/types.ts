export interface ChildLike {
  pid?: number
  on(event: 'exit', cb: (code: number | null) => void): void
  on(event: 'error', cb: (err: Error) => void): void
  kill(signal?: NodeJS.Signals): void
}

export interface SpawnOptions {
  env?: Record<string, string>
  cwd?: string
}

export type SpawnFn = (command: string, args: string[], options?: SpawnOptions) => ChildLike

export interface PathModule {
  join(...parts: string[]): string
  dirname(p: string): string
}
