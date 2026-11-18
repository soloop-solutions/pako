export class BackupQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private shared = new AbortController()

  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.catch(() => undefined)
    return run
  }

  backup<T>(fn: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const combined = signal ? AbortSignal.any([this.shared.signal, signal]) : this.shared.signal
    return this.exclusive(async () => {
      if (combined.aborted) throw new Error('Backup aborted')
      return fn(combined)
    })
  }

  abortBackups(): void {
    this.shared.abort()
  }

  async idle(): Promise<void> {
    let seen: Promise<unknown>
    do {
      seen = this.tail
      await seen
    } while (seen !== this.tail)
  }
}
