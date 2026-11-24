import net from 'node:net'

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not determine a free port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
  })
}

export async function chooseApiPort(deps: {
  saved: number | undefined
  isFree: (port: number) => Promise<boolean>
  getFree: () => Promise<number>
  persist: (port: number) => Promise<void>
}): Promise<number> {
  if (deps.saved !== undefined && (await deps.isFree(deps.saved))) return deps.saved
  const port = await deps.getFree()
  await deps.persist(port).catch((err: unknown) =>
    console.error(`[ports] could not save the API port: ${err instanceof Error ? err.message : String(err)}`),
  )
  return port
}
