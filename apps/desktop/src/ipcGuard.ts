import type { RestoreResult } from '@pako/shared'

export function isTrustedSender(frameUrl: string | undefined, apiOrigin: string): boolean {
  if (!frameUrl || !apiOrigin) return false
  try {
    const frame = new URL(frameUrl)
    const api = new URL(apiOrigin)
    return frame.protocol === 'http:' && frame.origin === api.origin
  } catch {
    return false
  }
}

export interface RestoreRequestDeps {
  senderUrl: string | undefined
  apiOrigin: string
  chooseFile(): Promise<string | null>
  confirm(file: string): Promise<boolean>
  restore(file: string): Promise<RestoreResult>
}

export async function handleRestoreRequest(deps: RestoreRequestDeps): Promise<RestoreResult> {
  if (!isTrustedSender(deps.senderUrl, deps.apiOrigin)) return { ok: false, error: 'Untrusted sender' }
  try {
    const file = await deps.chooseFile()
    if (!file) return { ok: false, error: 'cancelled' }
    if (!(await deps.confirm(file))) return { ok: false, error: 'cancelled' }
    return await deps.restore(file)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
