import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface LogWriter {
  write(chunk: Buffer | string): void
}

export interface LogWriterOptions {
  maxBytes?: number
  keep?: number
}

export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_LOG_KEEP = 5

export function createLogWriter(
  dir: string,
  name: string,
  options: LogWriterOptions = {},
): LogWriter {
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES
  const keep = Math.max(1, options.keep ?? DEFAULT_LOG_KEEP)
  const active = join(dir, `${name}.log`)
  const rotated = (n: number) => join(dir, `${name}.${n}.log`)

  mkdirSync(dir, { recursive: true })
  let size = existsSync(active) ? statSync(active).size : 0

  const rotate = () => {
    if (keep === 1) {
      rmSync(active, { force: true })
    } else {
      rmSync(rotated(keep - 1), { force: true })
      for (let n = keep - 2; n >= 1; n--) {
        if (existsSync(rotated(n))) renameSync(rotated(n), rotated(n + 1))
      }
      if (existsSync(active)) renameSync(active, rotated(1))
    }
    size = 0
  }

  return {
    write(chunk) {
      const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      if (size > 0 && size + data.length > maxBytes) rotate()
      appendFileSync(active, data)
      size += data.length
    },
  }
}
