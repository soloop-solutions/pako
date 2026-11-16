import { spawn } from 'node:child_process'
import type { SpawnFn } from './types'

export const defaultSpawn: SpawnFn = (command, args, options) =>
  spawn(command, args, {
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
    env: options?.env ? { ...process.env, ...options.env } : process.env,
    cwd: options?.cwd,
  })
