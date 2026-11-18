export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  on(event: 'second-instance', cb: () => void): void
  quit(): void
}

export function setupSingleInstance(app: SingleInstanceApp, focusWindow: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', focusWindow)
  return true
}
