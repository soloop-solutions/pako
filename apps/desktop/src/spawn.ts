import { spawn } from 'node:child_process'
import nodePath from 'node:path'
import { createLogWriter, type LogWriter } from './logWriter'
import type { SpawnFn } from './types'

export const defaultSpawn: SpawnFn = (command, args, options) =>
  spawn(command, args, {
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
    env: options?.env ? { ...process.env, ...options.env } : process.env,
    cwd: options?.cwd,
  })

export function createLoggedSpawn(logDir: string): SpawnFn {
  const writers = new Map<string, LogWriter>()
  const writerFor = (command: string): LogWriter => {
    const name = nodePath.basename(command).replace(/\.exe$/i, '')
    let writer = writers.get(name)
    if (!writer) {
      writer = createLogWriter(logDir, name)
      writers.set(name, writer)
    }
    return writer
  }
  return (command, args, options) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      cwd: options?.cwd,
    })
    const writer = writerFor(command)
    const sink = (chunk: Buffer) => {
      try {
        writer.write(chunk)
      } catch {}
    }
    child.stdout.on('data', sink)
    child.stderr.on('data', sink)
    return child
  }
}
